import React from 'react';
import { NavLink } from 'react-router-dom';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SidebarItem } from '../../contexts/SidebarContext';

interface DraggableSidebarItemProps {
  item: SidebarItem;
  onLinkClick: () => void;
  isMobile?: boolean;
  isDragDisabled?: boolean;
}

const DraggableSidebarItem: React.FC<DraggableSidebarItemProps> = ({
  item,
  onLinkClick,
  isMobile = false,
  isDragDisabled = false,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    disabled: isDragDisabled
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1000 : 'auto',
    opacity: isDragging ? 0.8 : 1,
  };

  // For mobile, we'll make the entire item draggable but prevent navigation when dragging
  const handleLinkClick = (e: React.MouseEvent) => {
    if (isDragging) {
      e.preventDefault();
      return;
    }
    onLinkClick();
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`sidebar-menu-item ${isDragging ? 'dragging' : ''} ${isMobile ? 'mobile' : ''}`}
    >
      {isMobile ? (
        // On mobile, make the entire link draggable with long press
        <NavLink
          to={item.path}
          className={({ isActive }) =>
            `sidebar-link ${isActive ? 'active' : ''}`
          }
          end={item.path === '/'}
          onClick={handleLinkClick}
          {...(!isDragDisabled && attributes)}
          {...(!isDragDisabled && listeners)}
        >
          {!isDragDisabled && (
            <span className="sidebar-drag-handle mobile-drag-handle">
              <svg
                className="drag-handle-icon"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 320 512"
              >
                <path
                  fill="currentColor"
                  d="M40 352l48 0c22.1 0 40 17.9 40 40l0 48c0 22.1-17.9 40-40 40l-48 0c-22.1 0-40-17.9-40-40l0-48c0-22.1 17.9-40 40-40zm192 0l48 0c22.1 0 40 17.9 40 40l0 48c0 22.1-17.9 40-40 40l-48 0c-22.1 0-40-17.9-40-40l0-48c0-22.1 17.9-40 40-40zM40 320c-22.1 0-40-17.9-40-40l0-48c0-22.1 17.9-40 40-40l48 0c22.1 0 40 17.9 40 40l0 48c0 22.1-17.9 40-40 40l-48 0zM232 192l48 0c22.1 0 40 17.9 40 40l0 48c0 22.1-17.9 40-40 40l-48 0c-22.1 0-40-17.9-40-40l0-48c0-22.1 17.9-40 40-40zM40 160c-22.1 0-40-17.9-40-40L0 72C0 49.9 17.9 32 40 32l48 0c22.1 0 40 17.9 40 40l0 48c0 22.1-17.9 40-40 40l-48 0zM232 32l48 0c22.1 0 40 17.9 40 40l0 48c0 22.1-17.9 40-40 40l-48 0c-22.1 0-40-17.9-40-40l0-48c0-22.1 17.9-40 40-40z"
                />
              </svg>
            </span>
          )}
          <span className="sidebar-icon">{item.icon}</span>
          <span className="sidebar-label">{item.label}</span>
        </NavLink>
      ) : (
        // Desktop version with separate drag handle
        <NavLink
          to={item.path}
          className={({ isActive }) =>
            `sidebar-link ${isActive ? 'active' : ''}`
          }
          end={item.path === '/'}
          onClick={handleLinkClick}
        >
          {!isDragDisabled && (
            <span
              className="sidebar-drag-handle"
              {...attributes}
              {...listeners}
              title="Drag to reorder"
            >
              <svg
                className="drag-handle-icon"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 320 512"
              >
                <path
                  fill="currentColor"
                  d="M40 352l48 0c22.1 0 40 17.9 40 40l0 48c0 22.1-17.9 40-40 40l-48 0c-22.1 0-40-17.9-40-40l0-48c0-22.1 17.9-40 40-40zm192 0l48 0c22.1 0 40 17.9 40 40l0 48c0 22.1-17.9 40-40 40l-48 0c-22.1 0-40-17.9-40-40l0-48c0-22.1 17.9-40 40-40zM40 320c-22.1 0-40-17.9-40-40l0-48c0-22.1 17.9-40 40-40l48 0c22.1 0 40 17.9 40 40l0 48c0 22.1-17.9 40-40 40l-48 0zM232 192l48 0c22.1 0 40 17.9 40 40l0 48c0 22.1-17.9 40-40 40l-48 0c-22.1 0-40-17.9-40-40l0-48c0-22.1 17.9-40 40-40zM40 160c-22.1 0-40-17.9-40-40L0 72C0 49.9 17.9 32 40 32l48 0c22.1 0 40 17.9 40 40l0 48c0 22.1-17.9 40-40 40l-48 0zM232 32l48 0c22.1 0 40 17.9 40 40l0 48c0 22.1-17.9 40-40 40l-48 0c-22.1 0-40-17.9-40-40l0-48c0-22.1 17.9-40 40-40z"
                />
              </svg>
            </span>
          )}
          <span className="sidebar-icon">{item.icon}</span>
          <span className="sidebar-label">{item.label}</span>
        </NavLink>
      )}
    </li>
  );
};

export default DraggableSidebarItem;
