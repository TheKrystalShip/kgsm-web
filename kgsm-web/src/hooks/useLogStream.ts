import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import kgsmService from '../services/kgsmService';

interface UseLogStreamOptions {
  instanceName: string;
  enabled: boolean;
  fallbackToPolling?: boolean;
  pollingInterval?: number;
}

interface LogStreamState {
  logs: string;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  connectionType: 'websocket' | 'polling' | 'none';
}

/**
 * Custom hook for real-time log streaming with WebSocket and REST fallback
 */
export const useLogStream = ({
  instanceName,
  enabled,
  fallbackToPolling = true,
  pollingInterval = 5000
}: UseLogStreamOptions): LogStreamState & {
  reconnect: () => void;
  clearLogs: () => void;
} => {
  const [logs, setLogs] = useState<string>('');
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionType, setConnectionType] = useState<'websocket' | 'polling' | 'none'>('none');

  const socketRef = useRef<Socket | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isUnmountedRef = useRef<boolean>(false);

  // Cleanup function
  const cleanup = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  // Fallback to REST polling
  const startPolling = useCallback(async () => {
    if (!enabled || isUnmountedRef.current) return;

    console.log(`🔄 Starting REST polling for ${instanceName}`);
    setConnectionType('polling');
    setIsConnected(true);

    const poll = async () => {
      if (!enabled || isUnmountedRef.current) return;

      try {
        const newLogs = await kgsmService.getInstanceLogs(instanceName);
        if (!isUnmountedRef.current) {
          setLogs(newLogs);
          setError(null);
        }
      } catch (err) {
        if (!isUnmountedRef.current) {
          console.error(`Polling error for ${instanceName}:`, err);
          setError('Failed to fetch logs');
        }
      }
    };

    // Initial poll
    await poll();

    // Start polling interval
    pollingIntervalRef.current = setInterval(poll, pollingInterval);
  }, [instanceName, enabled, pollingInterval]);

  // WebSocket connection
  const connectWebSocket = useCallback(() => {
    if (!enabled || isUnmountedRef.current || socketRef.current?.connected) return;

    console.log(`🔌 Connecting WebSocket for ${instanceName}`);
    setIsLoading(true);
    setConnectionType('websocket');

    // Get the WebSocket server URL
    const getSocketUrl = (): string => {
      // Allow override via environment variable for mobile testing
      if (process.env.REACT_APP_SOCKET_URL) {
        return process.env.REACT_APP_SOCKET_URL;
      }

      // Use the current host with port 3001 for development
      const currentHost = window.location.hostname;
      return `http://${currentHost}:3001`;
    };

    const socket = io(getSocketUrl(), {
      transports: ['websocket', 'polling'],
      timeout: 5000,
      retries: 3
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      if (isUnmountedRef.current) return;

      console.log(`✅ WebSocket connected for ${instanceName}`);
      setIsConnected(true);
      setIsLoading(false);
      setError(null);

      // Subscribe to logs
      socket.emit('subscribe-logs', instanceName);
    });

    socket.on('log-history', (historyData: string) => {
      if (isUnmountedRef.current) return;

      console.log(`📜 Received log history for ${instanceName} (${historyData.length} chars)`);
      setLogs(historyData);
    });

    socket.on('log-data', (logData: string) => {
      if (isUnmountedRef.current) return;

      setLogs(prev => prev + logData);
    });

    socket.on('subscription-confirmed', ({ instanceName: confirmedInstance, bufferSize }) => {
      if (isUnmountedRef.current) return;

      console.log(`📡 Subscription confirmed for ${confirmedInstance} (buffer: ${bufferSize} lines)`);
    });

    socket.on('stream-ended', ({ instanceName: endedInstance, exitCode, reason }) => {
      if (isUnmountedRef.current) return;

      console.log(`📡 Stream ended for ${endedInstance} (code: ${exitCode}, reason: ${reason})`);
      const endMessage = `\n[${new Date().toISOString()}] Stream ended\n`;
      setLogs(prev => prev + endMessage);
    });

    socket.on('stream-error', ({ instanceName: errorInstance, error: streamError }) => {
      if (isUnmountedRef.current) return;

      console.error(`❌ Stream error for ${errorInstance}:`, streamError);
      setError(`Stream error: ${streamError}`);
    });

    socket.on('disconnect', (reason) => {
      if (isUnmountedRef.current) return;

      console.log(`🔌 WebSocket disconnected for ${instanceName}: ${reason}`);
      setIsConnected(false);

      // Try to reconnect unless it was intentional
      if (reason !== 'io client disconnect' && enabled && fallbackToPolling) {
        console.log(`🔄 WebSocket failed, falling back to polling for ${instanceName}`);
        setConnectionType('polling');
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!isUnmountedRef.current) {
            startPolling();
          }
        }, 2000);
      }
    });

    socket.on('connect_error', (err) => {
      if (isUnmountedRef.current) return;

      console.error(`❌ WebSocket connection error for ${instanceName}:`, err);
      setIsLoading(false);
      setError('Connection failed');

      // Fallback to polling if WebSocket fails
      if (fallbackToPolling) {
        console.log(`🔄 WebSocket failed, falling back to polling for ${instanceName}`);
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!isUnmountedRef.current) {
            startPolling();
          }
        }, 1000);
      }
    });

  }, [instanceName, enabled, fallbackToPolling, startPolling]);

  // Manual reconnect function
  const reconnect = useCallback(() => {
    cleanup();
    setLogs('');
    setError(null);
    setIsConnected(false);
    setConnectionType('none');

    if (enabled) {
      setTimeout(connectWebSocket, 100);
    }
  }, [cleanup, connectWebSocket, enabled]);

  // Clear logs function
  const clearLogs = useCallback(() => {
    setLogs('');
  }, []);

  // Main effect - start connection when enabled
  useEffect(() => {
    isUnmountedRef.current = false;

    if (enabled && instanceName) {
      connectWebSocket();
    } else {
      cleanup();
      setConnectionType('none');
      setIsConnected(false);
    }

    return () => {
      isUnmountedRef.current = true;

      // Unsubscribe from logs before disconnecting
      if (socketRef.current?.connected) {
        socketRef.current.emit('unsubscribe-logs', instanceName);
      }

      cleanup();
    };
  }, [enabled, instanceName, connectWebSocket, cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isUnmountedRef.current = true;
      cleanup();
    };
  }, [cleanup]);

  return {
    logs,
    isConnected,
    isLoading,
    error,
    connectionType,
    reconnect,
    clearLogs
  };
};
