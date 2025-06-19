import React from 'react';
import BlueprintList from '../components/blueprints/BlueprintList';

const BlueprintsPage: React.FC = () => {
  return (
    <div>
      <h1>Blueprints</h1>
      <p>Browse and install game server blueprints</p>
      <BlueprintList />
    </div>
  );
};

export default BlueprintsPage;
