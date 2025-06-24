import React, { useState, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useSidebar } from '../../contexts/SidebarContext';
import { usePreferences } from '../../contexts/PreferencesContext';
import DraggableSidebarItem from './DraggableSidebarItem';
import './Sidebar.css';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onToggle }) => {
  const [isMobile, setIsMobile] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const { sidebarItems, reorderItems, resetOrder } = useSidebar();
  const { preferences } = usePreferences();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: isMobile ? 10 : 8, // Slightly more distance on mobile
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200, // 200ms delay for touch to distinguish from scrolling
        tolerance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleLinkClick = () => {
    if (isMobile) {
      onToggle(); // Close sidebar on mobile when a link is clicked
    }
  };

  const handleOverlayClick = () => {
    if (isMobile && isOpen) {
      onToggle();
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setIsDragging(true);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setIsDragging(false);

    if (over && active.id !== over.id) {
      reorderItems(active.id as string, over.id as string);
    }
  };

  return (
    <>
      <aside className={`sidebar ${isOpen ? 'open' : ''} ${isDragging && isMobile ? 'mobile-dragging' : ''}`}>
        <div className="sidebar-content">
          <nav className="sidebar-nav">
            {preferences.enableDragAndDrop ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={sidebarItems.map(item => item.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="sidebar-menu">
                    {sidebarItems.map((item) => (
                      <DraggableSidebarItem
                        key={item.id}
                        item={item}
                        onLinkClick={handleLinkClick}
                        isMobile={isMobile}
                        isDragDisabled={!preferences.enableDragAndDrop}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            ) : (
              <ul className="sidebar-menu">
                {sidebarItems.map((item) => (
                  <DraggableSidebarItem
                    key={item.id}
                    item={item}
                    onLinkClick={handleLinkClick}
                    isMobile={isMobile}
                    isDragDisabled={true}
                  />
                ))}
              </ul>
            )}

            {/* Mobile drag feedback */}
            {isMobile && isDragging && preferences.enableDragAndDrop && (
              <div className="mobile-drag-feedback">
                <p>Drag to reorder items</p>
              </div>
            )}
          </nav>

          {/* Help text for drag and drop - only show if drag and drop is enabled */}
          {preferences.enableDragAndDrop && (
            <div className="sidebar-help">
              <p className="sidebar-help-text">
                <svg className="sidebar-help-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
                  <path fill="currentColor" d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM216 336h24V272H216c-13.3 0-24-10.7-24-24s10.7-24 24-24h48c13.3 0 24 10.7 24 24v88h8c13.3 0 24 10.7 24 24s-10.7 24-24 24H216c-13.3 0-24-10.7-24-24s10.7-24 24-24zm40-208a32 32 0 1 1 0 64 32 32 0 1 1 0-64z"/>
                </svg>
                {isMobile ? 'Long press and drag to reorder' : 'Hover and drag to reorder'}
              </p>
              <button
                className="sidebar-reset-btn"
                onClick={resetOrder}
                title="Reset to default order"
              >
                Reset Order
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile overlay */}
      {isMobile && isOpen && (
        <div
          className="sidebar-overlay"
          onClick={handleOverlayClick}
          aria-hidden="true"
        />
      )}
    </>
  );
};

export default Sidebar;
