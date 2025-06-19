import React, { useState, useEffect, useRef, useCallback } from 'react';
import Modal from '../layout/Modal';
import { KgsmInstance } from '../../models/kgsm';
import kgsmService from '../../services/kgsmService';
import './InstanceConsoleModal.css';

interface InstanceConsoleModalProps {
  instance: KgsmInstance;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Modal for displaying and interacting with server instance console
 */
const InstanceConsoleModal: React.FC<InstanceConsoleModalProps> = ({
  instance,
  isOpen,
  onClose
}) => {
  const [logs, setLogs] = useState<string>('');
  const [command, setCommand] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState<boolean>(true); // Set to true by default
  const [newLogsIndicator, setNewLogsIndicator] = useState<boolean>(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Fetch instance logs and append to existing logs
  const fetchLogs = useCallback(async () => {
    try {
      setError(null);
      // Get logs from the KGSM service
      const logsData = await kgsmService.getInstanceLogs(instance.Name);

      // If this is the first fetch, set the logs directly
      // Otherwise, append new logs if different from existing logs
      setLogs(prevLogs => {
        if (!prevLogs || prevLogs.length === 0 || isLoading) {
          return logsData;
        }

        // If the new logs contain the old logs, show only the new content
        // This handles cases where the server returns all logs each time
        if (logsData.includes(prevLogs)) {
          const newContent = logsData.substring(logsData.indexOf(prevLogs) + prevLogs.length);
          // Show indicator if there's new content and auto-scroll is off
          if (newContent) {
            if (!autoScroll) {
              setNewLogsIndicator(true);
            } else {
              setNewLogsIndicator(false);
            }
          }
          return prevLogs + (newContent || '');
        } else {      // If logs don't contain previous logs, probably restarted or logs were rotated
      // Add a separator and append the new logs
      // Show indicator if there's new content and auto-scroll is off
      if (logsData !== prevLogs) {
        if (!autoScroll) {
          setNewLogsIndicator(true);
        } else {
          setNewLogsIndicator(false);
        }
      }
      return prevLogs + '\n\n--- Log continued at ' + new Date().toLocaleString() + ' ---\n\n' + logsData;
        }
      });

      setIsLoading(false);
    } catch (err) {
      // Don't set error if we already have some logs - just continue with existing logs
      if (logs.length === 0) {
        setError('Failed to fetch logs');
      }
      setIsLoading(false);

      // In development, set mock logs
      if (process.env.NODE_ENV === 'development' && logs.length === 0) {
        setLogs(`[${new Date().toISOString()}] Mock logs for ${instance.Name}\n`.repeat(10));
      }
    }
  }, [instance.Name, isLoading, logs.length, autoScroll]);

  // Handle sending command to the server
  const handleSendCommand = async () => {
    if (!command.trim()) return;

    try {
      await kgsmService.sendCommand(instance.Name, command);

      // Add the command to the logs with a prefix
      setLogs(prev => `${prev}\n> ${command}`);

      // Clear the command input
      setCommand('');

      // Re-enable auto-scrolling when user sends a command
      setAutoScroll(true);

      // Fetch logs again to see the result of the command
      setTimeout(fetchLogs, 1000);
    } catch (err) {
      setError('Failed to send command');
    }
  };

  // Start polling for logs when modal opens
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    if (isOpen) {
      // Initial fetch
      fetchLogs();

      // Set up new polling interval (use 3 seconds to get more frequent updates)
      interval = setInterval(fetchLogs, 3000);
      intervalRef.current = interval;
    } else {
      // Modal is closed, clear any existing interval
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    // Clean up when component unmounts or dependencies change
    return () => {
      if (interval) {
        clearInterval(interval);
      }
      // Also clear the ref in case it wasn't cleared elsewhere
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isOpen, instance.Name, fetchLogs]);

  // Function to scroll terminal to bottom
  const scrollToBottom = useCallback((smooth = false) => {
    if (terminalRef.current) {
      terminalRef.current.scrollTo({
        top: terminalRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto'
      });
    }
  }, []);

  // Scroll terminal to bottom when logs update only if autoScroll is enabled or on initial load
  useEffect(() => {
    if ((autoScroll || isLoading) && terminalRef.current && consoleEndRef.current) {
      scrollToBottom(false);
    }
  }, [logs, autoScroll, isLoading, scrollToBottom]);

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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${instance.Name} Console`}
      modalType="console"
    >
      <div className="instance-console-container">
        <div className="console-info">
          <div className="console-status">
            <span
              className={`status-indicator ${
                instance.Status === 'active' ? 'status-active' : 'status-inactive'
              }`}
            ></span>
            <span>{instance.Status === 'active' ? 'Running' : 'Stopped'}</span>
          </div>
          {instance.PID && instance.PID !== 'None' && (
            <div className="console-pid">PID: {instance.PID}</div>
          )}
          <div
            className={`auto-scroll-toggle ${autoScroll ? 'active' : ''}`}
            onClick={() => setAutoScroll(prev => !prev)}
            title={autoScroll ? "Auto-scroll enabled" : "Auto-scroll disabled"}
          >
            Auto-scroll {autoScroll ? 'ON' : 'OFF'}
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
              <button onClick={fetchLogs} className="btn btn-primary btn-sm">
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
                  placeholder={instance.Status === 'active' ? "Enter command..." : "Server not running"}
                  disabled={instance.Status !== 'active'}
                />
                <button
                  onClick={handleSendCommand}
                  disabled={!command.trim() || instance.Status !== 'active'}
                  className="btn btn-primary btn-sm"
                >
                  Send
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default InstanceConsoleModal;
