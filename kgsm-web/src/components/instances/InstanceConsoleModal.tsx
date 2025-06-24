import React, { useState, useEffect, useRef, useCallback } from 'react';
import Modal from '../layout/Modal';
import { KgsmInstance } from '../../models/kgsm';
import kgsmService from '../../services/kgsmService';
import { useLogStream } from '../../hooks/useLogStream';
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
  const [command, setCommand] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [newLogsIndicator, setNewLogsIndicator] = useState<boolean>(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  // Use the new WebSocket log streaming hook
  const {
    logs,
    isConnected,
    isLoading,
    error,
    connectionType,
    reconnect,
  } = useLogStream({
    instanceName: instance.Name,
    enabled: isOpen,
    fallbackToPolling: true,
    pollingInterval: 3000
  });

  // Enhanced onClose handler
  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  // Handle sending command to the server
  const handleSendCommand = async () => {
    if (!command.trim()) return;

    try {
      await kgsmService.sendCommand(instance.Name, command);

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
  }, [logs, autoScroll, scrollToBottom]); // Removed isLoading from dependencies

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
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
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
          <div className="console-connection">
            <span
              className={`connection-indicator ${
                isConnected ? 'connected' : 'disconnected'
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
