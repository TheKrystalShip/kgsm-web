/**
 * KGSM Service
 *
 * Service layer to interact with the KGSM CLI tool
 */

import axios from 'axios';
import { ENDPOINTS } from '../api/config';
import {
  KgsmInstancesResponse,
  KgsmBlueprintsResponse,
  KgsmInstanceStatus
} from '../models/kgsm';

/**
 * Service class for interacting with KGSM CLI
 */
class KgsmService {
  private apiEndpoint: string;

  constructor() {
    this.apiEndpoint = ENDPOINTS.KGSM;
  }

  /**
   * Get all instances
   */
  async getInstances(): Promise<KgsmInstancesResponse> {
    try {
      const response = await axios.get(`${this.apiEndpoint}/instances`);
      return response.data;
    } catch (error) {
      console.error('Failed to get instances:', error);
      throw error;
    }
  }

  /**
   * Get instance status
   */
  async getInstanceStatus(instanceName: string, fast: boolean = false): Promise<KgsmInstanceStatus> {
    try {
      const params = fast ? { fast: 'true' } : {};
      const response = await axios.get(`${this.apiEndpoint}/instances/${instanceName}/status`, { params });
      return response.data;
    } catch (error) {
      console.error(`Failed to get instance status for ${instanceName}:`, error);
      throw error;
    }
  }

  /**
   * Get all blueprints
   */
  async getBlueprints(): Promise<KgsmBlueprintsResponse> {
    try {
      const response = await axios.get(`${this.apiEndpoint}/blueprints`);
      return response.data;
    } catch (error) {
      console.error('Failed to get blueprints:', error);
      throw error;
    }
  }

  /**
   * Install a new instance
   * @param blueprint - Blueprint name to install
   * @param instanceId - Optional instance ID
   * @param installDir - Optional installation directory
   * @param version - Optional version to install
   */
  async installInstance(
    blueprint: string,
    instanceId?: string,
    installDir?: string,
    version?: string
  ): Promise<any> {
    try {
      const response = await axios.post(`${this.apiEndpoint}/instances`, {
        blueprint,
        instanceId,
        installDir,
        version
      });
      return response.data;
    } catch (error) {
      console.error(`Failed to install instance from blueprint ${blueprint}:`, error);
      throw error;
    }
  }

  /**
   * Uninstall an instance
   */
  async uninstallInstance(instanceName: string): Promise<any> {
    try {
      const response = await axios.delete(`${this.apiEndpoint}/instances/${instanceName}`);
      return response.data;
    } catch (error) {
      console.error(`Failed to uninstall instance ${instanceName}:`, error);
      throw error;
    }
  }

  /**
   * Start an instance
   */
  async startInstance(instanceName: string): Promise<any> {
    try {
      const response = await axios.post(`${this.apiEndpoint}/instances/${instanceName}/start`);
      return response.data;
    } catch (error) {
      console.error(`Failed to start instance ${instanceName}:`, error);
      throw error;
    }
  }

  /**
   * Stop an instance
   */
  async stopInstance(instanceName: string): Promise<any> {
    try {
      const response = await axios.post(`${this.apiEndpoint}/instances/${instanceName}/stop`);
      return response.data;
    } catch (error) {
      console.error(`Failed to stop instance ${instanceName}:`, error);
      throw error;
    }
  }

  /**
   * Restart an instance
   */
  async restartInstance(instanceName: string): Promise<any> {
    try {
      const response = await axios.post(`${this.apiEndpoint}/instances/${instanceName}/restart`);
      return response.data;
    } catch (error) {
      console.error(`Failed to restart instance ${instanceName}:`, error);
      throw error;
    }
  }

  /**
   * Update an instance to the latest version
   */
  async updateInstance(instanceName: string, version?: string): Promise<any> {
    try {
      const response = await axios.post(`${this.apiEndpoint}/instances/${instanceName}/update`, {
        version
      });
      return response.data;
    } catch (error) {
      console.error(`Failed to update instance ${instanceName}:`, error);
      throw error;
    }
  }

  /**
   * Get instance logs
   */
  async getInstanceLogs(instanceName: string): Promise<string> {
    try {
      const response = await axios.get(`${this.apiEndpoint}/instances/${instanceName}/logs`);
      return response.data;
    } catch (error) {
      console.error(`Failed to get logs for instance ${instanceName}:`, error);
      throw error;
    }
  }

  /**
   * Get instance logs with client tracking
   */
  async getInstanceLogsWithClient(instanceName: string, clientId: string): Promise<{ logs: string; clientId: string }> {
    try {
      const response = await axios.get(`${this.apiEndpoint}/instances/${instanceName}/logs`, {
        params: { clientId }
      });

      return {
        logs: response.data,
        clientId: response.headers['x-client-id'] || clientId
      };
    } catch (error) {
      console.error(`Failed to get logs for instance ${instanceName}:`, error);
      throw error;
    }
  }

  /**
   * Disconnect client from log stream
   */
  async disconnectFromLogs(instanceName: string, clientId: string): Promise<any> {
    try {
      const response = await axios.post(`${this.apiEndpoint}/instances/${instanceName}/logs/disconnect`, {
        clientId
      });
      return response.data;
    } catch (error) {
      console.error(`Failed to disconnect from logs for instance ${instanceName}:`, error);
      throw error;
    }
  }

  /**
   * Stop log processes for an instance (cleanup)
   */
  async stopInstanceLogs(instanceName: string): Promise<any> {
    try {
      const response = await axios.post(`${this.apiEndpoint}/instances/${instanceName}/logs/stop`);
      return response.data;
    } catch (error) {
      console.error(`Failed to stop log processes for instance ${instanceName}:`, error);
      throw error;
    }
  }

  /**
   * Get log process status for debugging
   */
  async getLogStatus(): Promise<any> {
    try {
      const response = await axios.get(`${this.apiEndpoint}/logs/status`);
      return response.data;
    } catch (error) {
      console.error('Failed to get log status:', error);
      throw error;
    }
  }

  /**
   * Send command to instance
   */
  async sendCommand(instanceName: string, command: string): Promise<any> {
    try {
      const response = await axios.post(`${this.apiEndpoint}/instances/${instanceName}/command`, {
        command
      });
      return response.data;
    } catch (error) {
      console.error(`Failed to send command to instance ${instanceName}:`, error);
      throw error;
    }
  }

  /**
   * Get system metrics
   */
  async getSystemMetrics(): Promise<any> {
    try {
      const response = await axios.get(`${this.apiEndpoint}/system/metrics`);
      return response.data;
    } catch (error) {
      console.error('Failed to get system metrics:', error);
      throw error;
    }
  }
}

const kgsmService = new KgsmService();
export default kgsmService;
