import React, { useState, useEffect, useRef, useCallback } from 'react';
import Modal from '../layout/Modal';
import { KgsmInstance } from '../../services/kgsmService';
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
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  // Fetch instance logs
  const fetchLogs = useCallback(async () => {
    try {
      setError(null);
      const logsData = await kgsmService.getInstanceLogs(instance.Name);
      setLogs(logsData);
      setIsLoading(false);
    } catch (err) {
      setError('Failed to fetch logs');
      setIsLoading(false);
      
      // In development, set mock logs
      if (process.env.NODE_ENV === 'development') {
        setLogs(`[${new Date().toISOString()}] Mock logs for ${instance.Name}\n`.repeat(10));
      }
    }
  }, [instance.Name]);

  // Handle sending command to the server
  const handleSendCommand = async () => {
    if (!command.trim()) return;
    
    try {
      await kgsmService.sendCommand(instance.Name, command);
      
      // Add the command to the logs with a prefix
      setLogs(prev => `${prev}\n> ${command}`);
      
      // Clear the command input
      setCommand('');
      
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
      
      // Set up new polling interval
      interval = setInterval(fetchLogs, 5000);
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

  // Scroll to bottom when logs update
  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Handle Enter key press in command input
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSendCommand();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${instance.Name} Console`}
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
              <div className="terminal">
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
