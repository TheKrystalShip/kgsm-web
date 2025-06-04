import React, { useState } from 'react';
import { KgsmInstance } from '../../services/kgsmService';
import { useInstances } from '../../hooks/useInstances';
import './InstanceCard.css';

// Import SVG icons directly instead of using react-icons
const PlayIcon = () => (
  <svg className="btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512">
    <path fill="currentColor" d="M424.4 214.7L72.4 6.6C43.8-10.3 0 6.1 0 47.9V464c0 37.5 40.7 60.1 72.4 41.3l352-208c31.4-18.5 31.5-64.1 0-82.6z" />
  </svg>
);

const StopIcon = () => (
  <svg className="btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512">
    <path fill="currentColor" d="M400 32H48C21.5 32 0 53.5 0 80v352c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48V80c0-26.5-21.5-48-48-48z" />
  </svg>
);

const RestartIcon = () => (
  <svg className="btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <path fill="currentColor" d="M440.65 12.57l4 82.77A247.16 247.16 0 0 0 255.83 8C134.73 8 33.91 94.92 12.29 209.82A12 12 0 0 0 24.09 224h49.05a12 12 0 0 0 11.67-9.26 175.91 175.91 0 0 1 317-56.94l-101.46-4.86a12 12 0 0 0-12.57 12v47.41a12 12 0 0 0 12 12H500a12 12 0 0 0 12-12V12a12 12 0 0 0-12-12h-47.37a12 12 0 0 0-11.98 12.57zM255.83 432a175.61 175.61 0 0 1-146-77.8l101.8 4.87a12 12 0 0 0 12.57-12v-47.4a12 12 0 0 0-12-12H12a12 12 0 0 0-12 12V500a12 12 0 0 0 12 12h47.35a12 12 0 0 0 12-12.6l-4.15-82.57A247.17 247.17 0 0 0 255.83 504c121.11 0 221.93-86.92 243.55-201.82a12 12 0 0 0-11.8-14.18h-49.05a12 12 0 0 0-11.67 9.26A175.86 175.86 0 0 1 255.83 432z" />
  </svg>
);

const TerminalIcon = () => (
  <svg className="btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512">
    <path fill="currentColor" d="M257.981 272.971L63.638 467.314c-9.373 9.373-24.569 9.373-33.941 0L7.029 444.647c-9.357-9.357-9.375-24.522-.04-33.901L161.011 256 6.99 101.255c-9.335-9.379-9.317-24.544.04-33.901l22.667-22.667c9.373-9.373 24.569-9.373 33.941 0L257.981 239.03c9.373 9.372 9.373 24.568 0 33.941zM640 456v-32c0-13.255-10.745-24-24-24H312c-13.255 0-24 10.745-24 24v32c0 13.255 10.745 24 24 24h304c13.255 0 24-10.745 24-24z" />
  </svg>
);

const TrashIcon = () => (
  <svg className="btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512">
    <path fill="currentColor" d="M268 416h24a12 12 0 0 0 12-12V188a12 12 0 0 0-12-12h-24a12 12 0 0 0-12 12v216a12 12 0 0 0 12 12zM432 80h-82.41l-34-56.7A48 48 0 0 0 274.41 0H173.59a48 48 0 0 0-41.16 23.3L98.41 80H16A16 16 0 0 0 0 96v16a16 16 0 0 0 16 16h16v336a48 48 0 0 0 48 48h288a48 48 0 0 0 48-48V128h16a16 16 0 0 0 16-16V96a16 16 0 0 0-16-16zM171.84 50.91A6 6 0 0 1 177 48h94a6 6 0 0 1 5.15 2.91L293.61 80H154.39zM368 464H80V128h288zm-212-48h24a12 12 0 0 0 12-12V188a12 12 0 0 0-12-12h-24a12 12 0 0 0-12 12v216a12 12 0 0 0 12 12z" />
  </svg>
);

const CloseIcon = () => (
  <svg className="btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 352 512">
    <path fill="currentColor" d="M242.72 256l100.07-100.07c12.28-12.28 12.28-32.19 0-44.48l-22.24-22.24c-12.28-12.28-32.19-12.28-44.48 0L176 189.28 75.93 89.21c-12.28-12.28-32.19-12.28-44.48 0L9.21 111.45c-12.28 12.28-12.28 32.19 0 44.48L109.28 256 9.21 356.07c-12.28 12.28-12.28 32.19 0 44.48l22.24 22.24c12.28 12.28 32.2 12.28 44.48 0L176 322.72l100.07 100.07c12.28 12.28 32.2 12.28 44.48 0l22.24-22.24c12.28-12.28 12.28-32.19 0-44.48L242.72 256z" />
  </svg>
);

interface InstanceCardProps {
  instance: KgsmInstance;
  onOpenConsole: (instance: KgsmInstance) => void;
}

/**
 * Component for displaying a single server instance as a card
 */
const InstanceCard: React.FC<InstanceCardProps> = ({ instance, onOpenConsole }) => {
  const { startInstance, stopInstance, restartInstance, uninstallInstance } = useInstances();
  const [isProcessing, setIsProcessing] = useState<string | null>(null);
  const [showUninstallConfirm, setShowUninstallConfirm] = useState<boolean>(false);

  // Format the installation date
  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString();
    } catch (e) {
      return dateString;
    }
  };

  // Handle start instance button click
  const handleStart = async () => {
    setIsProcessing('start');
    await startInstance(instance.Name);
    setIsProcessing(null);
  };

  // Handle stop instance button click
  const handleStop = async () => {
    setIsProcessing('stop');
    await stopInstance(instance.Name);
    setIsProcessing(null);
  };

  // Handle restart instance button click
  const handleRestart = async () => {
    setIsProcessing('restart');
    await restartInstance(instance.Name);
    setIsProcessing(null);
  };

  // Handle uninstall instance button click
  const handleUninstall = async () => {
    setIsProcessing('uninstall');
    await uninstallInstance(instance.Name);
    setIsProcessing(null);
  };

  // Get blueprint name from path
  const getBlueprintName = () => {
    const pathParts = instance.Blueprint.split('/');
    const filename = pathParts[pathParts.length - 1];
    return filename.replace('.bp', '');
  };

  return (
    <div className="instance-card">
      <div className="instance-card-header">
        <div className="instance-name-container">
          <span 
            className={`status-indicator ${
              instance.Status === 'active' ? 'status-active' : 'status-inactive'
            }`}
          ></span>
          <h3 className="instance-name">{instance.Name}</h3>
        </div>
        <div className="instance-status">
          {instance.Status === 'active' ? 'Running' : 'Stopped'}
        </div>
      </div>
      
      <div className="instance-details">
        <div className="detail-row">
          <span className="detail-label">Blueprint:</span>
          <span className="detail-value">{getBlueprintName()}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Version:</span>
          <span className="detail-value">{instance.Version}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Installed:</span>
          <span className="detail-value">{formatDate(instance.InstallationDate)}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Location:</span>
          <span className="detail-value">{instance.Directory}</span>
        </div>
      </div>
      
      <div className="instance-actions">
        {!showUninstallConfirm ? (
          <>
            <button
              className="btn btn-primary"
              onClick={() => onOpenConsole(instance)}
            >
              <TerminalIcon /> Console
            </button>
            {instance.Status === 'active' ? (
              <>
                <button
                  className="btn btn-warning"
                  onClick={handleRestart}
                  disabled={!!isProcessing}
                >
                  {isProcessing === 'restart' ? 
                    'Restarting...' : 
                    <><RestartIcon /> Restart</>
                  }
                </button>
                <button
                  className="btn btn-error"
                  onClick={handleStop}
                  disabled={!!isProcessing}
                >
                  {isProcessing === 'stop' ? 
                    'Stopping...' : 
                    <><StopIcon /> Stop</>
                  }
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn btn-success"
                  onClick={handleStart}
                  disabled={!!isProcessing}
                >
                  {isProcessing === 'start' ? 
                    'Starting...' : 
                    <><PlayIcon /> Start</>
                  }
                </button>
                <button
                  className="btn btn-error"
                  onClick={() => setShowUninstallConfirm(true)}
                  disabled={!!isProcessing}
                >
                  <TrashIcon /> Uninstall
                </button>
              </>
            )}
          </>
        ) : (
          <div className="confirm-uninstall">
            <p>Are you sure you want to uninstall this server?</p>
            <div className="confirm-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowUninstallConfirm(false)}
                disabled={isProcessing === 'uninstall'}
              >
                <CloseIcon /> Cancel
              </button>
              <button
                className="btn btn-error"
                onClick={handleUninstall}
                disabled={isProcessing === 'uninstall'}
              >
                {isProcessing === 'uninstall' ? 
                  'Uninstalling...' : 
                  <><TrashIcon /> Confirm Uninstall</>
                }
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default InstanceCard;
