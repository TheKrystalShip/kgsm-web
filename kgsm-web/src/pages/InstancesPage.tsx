import React from 'react';
import InstanceList from '../components/instances/InstanceList';

const InstancesPage: React.FC = () => {
  return (
    <div>
      <h1>Game Instances</h1>
      <p>Manage your game server instances</p>
      <InstanceList />
    </div>
  );
};

export default InstancesPage;
