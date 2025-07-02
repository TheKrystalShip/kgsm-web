import React, { useState, useRef, useCallback, useEffect } from 'react';
import { KgsmInstance } from '../../models/kgsm';
import { useInstancesStore } from '../../hooks/useInstancesStore';
import { useLogStream } from '../../hooks/useLogStream';
import kgsmService from '../../services/kgsmService';
import './InstanceConsole.css';

interface InstanceConsoleProps {
  instance: KgsmInstance;
}

/**
 * Console component for viewing server logs and sending commands
 */
const InstanceConsole: React.FC<InstanceConsoleProps> = ({ instance }) => {
  const [command, setCommand] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [newLogsIndicator, setNewLogsIndicator] = useState<boolean>(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  // Get instance status from Redux store
  const { instanceStatuses, fetchInstanceStatus } = useInstancesStore();
  const status = instanceStatuses[instance.name];
  const isRunning = status?.status === true;

  // Fetch status when component mounts (fast for initial load)
  useEffect(() => {
    fetchInstanceStatus(instance.name, true);
  }, [instance.name, fetchInstanceStatus]);

  // Use the WebSocket log streaming hook
  const {
    logs,
    isConnected,
    isLoading,
    error,
    connectionType,
    reconnect,
  } = useLogStream({
    instanceName: instance.name,
    enabled: true,
    fallbackToPolling: true,
    pollingInterval: 3000
  });

  // Handle sending command to the server
  const handleSendCommand = async () => {
    if (!command.trim()) return;

    try {
      await kgsmService.sendCommand(instance.name, command);

      // Clear the command input
      setCommand('');

      // Re-enable auto-scrolling when user sends a command
      setAutoScroll(true);

      // Command output will appear in the log stream automatically
    } catch (err) {
      console.error('Failed to send command:', err);
    }
  };

  // Function to scroll terminal to bottom
  const scrollToBottom = useCallback((smooth = false) => {
    if (terminalRef.current) {
      terminalRef.current.scrollTo({
        top: terminalRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto'
      });
    }
  }, []);

  // Scroll terminal to bottom when logs update only if autoScroll is enabled
  useEffect(() => {
    if (autoScroll && terminalRef.current && consoleEndRef.current) {
      scrollToBottom(false);
    }
  }, [logs, autoScroll, scrollToBottom]);

  // Handle Enter key press in command input
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSendCommand();
    }
  };

  // Handle scrolling in terminal
  const handleTerminalScroll = useCallback(() => {
    if (terminalRef.current) {
      // Check if user has scrolled up away from bottom
      const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
      const isScrolledToBottom = scrollHeight - scrollTop - clientHeight < 20; // 20px threshold

      // Only change autoScroll if user scrolled away from bottom
      if (!isScrolledToBottom && autoScroll) {
        setAutoScroll(false);
      } else if (isScrolledToBottom && !autoScroll) {
        // User manually scrolled to bottom, re-enable auto-scroll
        setAutoScroll(true);
        setNewLogsIndicator(false);
      }
    }
  }, [autoScroll]);

  // Show new logs indicator when logs update and user has scrolled away
  useEffect(() => {
    if (!autoScroll && terminalRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
      const isScrolledToBottom = scrollHeight - scrollTop - clientHeight < 20;
      if (!isScrolledToBottom) {
        setNewLogsIndicator(true);
      }
    }
  }, [logs, autoScroll]);

  return (
    <div className="instance-console">
      <div className="console-header">
        <h3>Console</h3>
        <div className="console-info">
          <div className="console-connection">
            <span
              className={`status-indicator ${
                isConnected ? 'status-active' : 'status-inactive'
              }`}
            ></span>
            <span>{connectionType === 'websocket' ? 'WebSocket' : connectionType === 'polling' ? 'Polling' : 'Disconnected'}</span>
          </div>
          <div
            className={`auto-scroll-toggle ${autoScroll ? 'active' : ''}`}
            onClick={() => setAutoScroll(prev => !prev)}
            title={autoScroll ? "Auto-scroll enabled" : "Auto-scroll disabled"}
          >
            Auto-scroll {autoScroll ? 'ON' : 'OFF'}
          </div>
        </div>
      </div>

      <div className="console-terminal">
        {isLoading ? (
          <div className="console-loading">
            <div className="spinner"></div>
            <p>Loading logs...</p>
          </div>
        ) : error ? (
          <div className="console-error">
            <p>{error}</p>
            <button onClick={reconnect} className="btn btn-primary btn-sm">
              Retry
            </button>
          </div>
        ) : (
          <>
            <div className="terminal" ref={terminalRef} onScroll={handleTerminalScroll}>
              {newLogsIndicator && !autoScroll && (
                <button
                  className="new-logs-indicator"
                  onClick={() => {
                    setAutoScroll(true);
                    setNewLogsIndicator(false);
                    scrollToBottom(true); // Scroll with smooth animation
                  }}
                >
                  New logs available ↓
                </button>
              )}
              <pre>{logs}</pre>
              <div ref={consoleEndRef}></div>
            </div>
            <div className="terminal-input">
              <span className="prompt">$</span>
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={isRunning ? "Enter command..." : "Server not running"}
                disabled={!isRunning}
              />
              <button
                onClick={handleSendCommand}
                disabled={!command.trim() || !isRunning}
                className="btn btn-primary btn-sm"
              >
                Send
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default InstanceConsole;
