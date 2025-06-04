// filepath: /home/heisen/kgsm-web/kgsm-web/src/components/blueprints/BlueprintList.tsx
import React, { useState, useRef } from 'react';
import { useBlueprints } from '../../hooks/useBlueprints';
import BlueprintCard from './BlueprintCard';
import BlueprintInstallModal from './BlueprintInstallModal';
import { KgsmBlueprint } from '../../services/kgsmService';
import './BlueprintList.css';

/**
 * Component for displaying all available blueprints as a carousel
 */
const BlueprintList: React.FC = () => {
  const { blueprints, loading, error } = useBlueprints();
  const [selectedBlueprint, setSelectedBlueprint] = useState<KgsmBlueprint | null>(null);
  const carouselRef = useRef<HTMLDivElement>(null);

  // Opens the install modal for a blueprint
  const handleOpenInstallModal = (blueprint: KgsmBlueprint) => {
    setSelectedBlueprint(blueprint);
  };

  // Closes the install modal
  const handleCloseInstallModal = () => {
    setSelectedBlueprint(null);
  };
  
  // Handle scrolling left
  const handleScrollLeft = () => {
    if (carouselRef.current) {
      carouselRef.current.scrollBy({ left: -200, behavior: 'smooth' });
    }
  };
  
  // Handle scrolling right
  const handleScrollRight = () => {
    if (carouselRef.current) {
      carouselRef.current.scrollBy({ left: 200, behavior: 'smooth' });
    }
  };

  // If loading, show loading indicator
  if (loading) {
    return (
      <div className="blueprint-list-container">
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading blueprints...</p>
        </div>
      </div>
    );
  }

  // If error, show error message
  if (error) {
    return (
      <div className="blueprint-list-container">
        <div className="error-container">
          <p>Failed to load blueprints: {error.message}</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Get array of blueprints from the object
  const blueprintArray = Object.values(blueprints);

  return (
    <div className="blueprint-list-container">
      <div className="blueprint-carousel-wrapper">
        <div className="carousel-shadow carousel-shadow-left"></div>
        <div className="carousel-shadow carousel-shadow-right"></div>
        
        <button className="scroll-indicator scroll-left" onClick={handleScrollLeft}>
          ←
        </button>
        
        <div className="blueprint-carousel" ref={carouselRef}>
          <div className="blueprint-list">
            {blueprintArray.map((blueprint) => (
              <BlueprintCard
                key={blueprint.Name}
                blueprint={blueprint}
                onSelect={handleOpenInstallModal}
              />
            ))}
          </div>
        </div>
        
        <button className="scroll-indicator scroll-right" onClick={handleScrollRight}>
          →
        </button>
      </div>
      
      {/* Install modal */}
      {selectedBlueprint && (
        <BlueprintInstallModal
          blueprint={selectedBlueprint}
          isOpen={!!selectedBlueprint}
          onClose={handleCloseInstallModal}
        />
      )}
    </div>
  );
};

export default BlueprintList;
