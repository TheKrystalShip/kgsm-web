import React, { useState } from 'react';
import { KgsmInstance } from '../../models/kgsm';
import { useInstancesStore } from '../../hooks/useInstancesStore';
import './InstanceActions.css';

// Import SVG icons directly
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

const UpdateIcon = () => (
  <svg className="btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <path fill="currentColor" d="M256 8C119.034 8 8 119.033 8 256s111.034 248 248 248 248-111.034 248-248S392.967 8 256 8zm0 448c-110.532 0-200-89.451-200-200 0-110.531 89.451-200 200-200 110.532 0 200 89.451 200 200 0 110.532-89.451 200-200 200zm-32-316v116h-67c-10.7 0-16 12.9-8.5 20.5l99 99c4.7 4.7 12.3 4.7 17 0l99-99c7.6-7.6 2.2-20.5-8.5-20.5h-67V140c0-6.6-5.4-12-12-12h-40c-6.6 0-12 5.4-12 12z"/>
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

interface InstanceActionsProps {
  instance: KgsmInstance;
}

/**
 * Component for instance management actions (start, stop, restart, update, uninstall)
 */
const InstanceActions: React.FC<InstanceActionsProps> = ({ instance }) => {
  const {
    startInstance,
    stopInstance,
    restartInstance,
    updateInstance,
    uninstallInstance,
    instanceStatuses,
    starting,
    stopping,
    restarting,
    updating,
    uninstalling
  } = useInstancesStore();

  const [showUninstallConfirm, setShowUninstallConfirm] = useState<boolean>(false);

  // Get status for this specific instance
  const status = instanceStatuses[instance.name];

  // Check if this specific instance is being processed
  const isProcessing = (action: string) => {
    switch (action) {
      case 'start': return starting === instance.name;
      case 'stop': return stopping === instance.name;
      case 'restart': return restarting === instance.name;
      case 'update': return updating === instance.name;
      case 'uninstall': return uninstalling === instance.name;
      default: return false;
    }
  };

  const isAnyProcessing = starting === instance.name ||
                         stopping === instance.name ||
                         restarting === instance.name ||
                         updating === instance.name ||
                         uninstalling === instance.name;

  // Determine if instance is running
  const isRunning = status?.status === true;

  // Handle start instance button click
  const handleStart = async () => {
    await startInstance(instance.name);
  };

  // Handle stop instance button click
  const handleStop = async () => {
    await stopInstance(instance.name);
  };

  // Handle restart instance button click
  const handleRestart = async () => {
    await restartInstance(instance.name);
  };

  // Handle uninstall instance button click
  const handleUninstall = async () => {
    await uninstallInstance(instance.name);
    setShowUninstallConfirm(false);
  };

  // Handle update instance button click
  const handleUpdate = async () => {
    await updateInstance(instance.name);
  };

  return (
    <div className="instance-actions">
      <div className="actions-header">
        <h3>Actions</h3>
      </div>

      {!showUninstallConfirm ? (
        <div className="actions-content">
          <div className="button-row">
            <button
              className="btn btn-success"
              onClick={handleStart}
              disabled={isAnyProcessing || isRunning}
            >
              {isProcessing('start') ?
                'Starting...' :
                <><PlayIcon /> Start</>
              }
            </button>
            <button
              className="btn btn-warning"
              onClick={handleRestart}
              disabled={isAnyProcessing || !isRunning}
            >
              {isProcessing('restart') ?
                'Restarting...' :
                <><RestartIcon /> Restart</>
              }
            </button>
            <button
              className="btn btn-error"
              onClick={handleStop}
              disabled={isAnyProcessing || !isRunning}
            >
              {isProcessing('stop') ?
                'Stopping...' :
                <><StopIcon /> Stop</>
              }
            </button>
          </div>

          <div className="button-row">
            <button
              className="btn btn-warning"
              onClick={handleUpdate}
              disabled={isAnyProcessing || isRunning}
              title={isRunning ? "Stop the server first to update" : undefined}
            >
              {isProcessing('update') ?
                'Updating...' :
                <><UpdateIcon /> Update</>
              }
            </button>
            <button
              className="btn btn-error"
              onClick={() => setShowUninstallConfirm(true)}
              disabled={isAnyProcessing || isRunning}
              title={isRunning ? "Stop the server first to uninstall" : undefined}
            >
              <TrashIcon /> Uninstall
            </button>
          </div>
        </div>
      ) : (
        <div className="confirm-uninstall">
          <p>Are you sure you want to uninstall this server?</p>
          <div className="confirm-actions">
            <button
              className="btn btn-secondary"
              onClick={() => setShowUninstallConfirm(false)}
              disabled={isProcessing('uninstall')}
            >
              <CloseIcon /> Cancel
            </button>
            <button
              className="btn btn-error"
              onClick={handleUninstall}
              disabled={isProcessing('uninstall')}
            >
              {isProcessing('uninstall') ?
                'Uninstalling...' :
                <><TrashIcon /> Confirm Uninstall</>
              }
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default InstanceActions;
