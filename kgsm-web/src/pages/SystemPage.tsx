import React from 'react';
import SystemMetrics from '../components/graphs/SystemMetrics';

const SystemPage: React.FC = () => {
  return (
    <div>
      <h1>System</h1>
      <p>Monitor system performance</p>
      <SystemMetrics />
    </div>
  );
};

export default SystemPage;
