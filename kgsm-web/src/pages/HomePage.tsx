import React from 'react';
import FoldableSection from '../components/common/FoldableSection';
import SystemMetrics from '../components/graphs/SystemMetrics';
import BlueprintList from '../components/blueprints/BlueprintList';
import InstanceList from '../components/instances/InstanceList';

const HomePage: React.FC = () => {
  return (
    <div>
      <FoldableSection
        title={
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 10h-4V6"></path>
              <path d="M22 12c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2s10 4.477 10 10z"></path>
              <path d="M12 14v-8"></path>
            </svg>
            System Health
          </>
        }
        defaultExpanded={true}
      >
        <SystemMetrics />
      </FoldableSection>

      <FoldableSection
        title={
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="5" width="20" height="14" rx="2"></rect>
              <line x1="2" y1="10" x2="22" y2="10"></line>
            </svg>
            Available Game Servers
          </>
        }
        defaultExpanded={true}
      >
        <BlueprintList />
      </FoldableSection>

      <FoldableSection
        title={
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"></rect>
              <path d="M3 9h18"></path>
              <path d="M9 21V9"></path>
            </svg>
            Installed Instances
          </>
        }
        defaultExpanded={true}
      >
        <InstanceList />
      </FoldableSection>
    </div>
  );
};

export default HomePage;
