import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface SidebarItem {
  id: string;
  path: string;
  label: string;
  icon: React.ReactNode;
}

interface SidebarContextType {
  sidebarItems: SidebarItem[];
  reorderItems: (activeId: string, overId: string) => void;
  resetOrder: () => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

const STORAGE_KEY = 'kgsm-sidebar-order';

// Default sidebar items with unique IDs
const defaultSidebarItems: SidebarItem[] = [
  {
    id: 'dashboard',
    path: '/',
    label: 'Dashboard',
    icon: (
      <svg className="sidebar-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
        <path fill="currentColor" d="M32 32c17.7 0 32 14.3 32 32V400c0 17.7-14.3 32-32 32s-32-14.3-32-32V64C0 46.3 14.3 32 32 32zm64 112V400c0 17.7 14.3 32 32 32s32-14.3 32-32V144c0-17.7-14.3-32-32-32s-32 14.3-32 32zM224 64c17.7 0 32 14.3 32 32V400c0 17.7-14.3 32-32 32s-32-14.3-32-32V96c0-17.7-14.3-32 32-32zm64 112V400c0 17.7 14.3 32 32 32s32-14.3 32-32V176c0-17.7-14.3-32-32-32s-32 14.3-32 32zM416 240c17.7 0 32 14.3 32 32V400c0 17.7-14.3 32-32 32s-32-14.3-32-32V272c0-17.7 14.3-32 32-32z"/>
      </svg>
    )
  },
  {
    id: 'blueprints',
    path: '/blueprints',
    label: 'Blueprints',
    icon: (
      <svg className="sidebar-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512">
        <path fill="currentColor" d="M64 0C28.7 0 0 28.7 0 64V448c0 35.3 28.7 64 64 64H320c35.3 0 64-28.7 64-64V160H256c-17.7 0-32-14.3-32-32V0H64zM256 0V128H384L256 0zM112 256H272c8.8 0 16 7.2 16 16s-7.2 16-16 16H112c-8.8 0-16-7.2-16-16s7.2-16 16-16zm0 64H272c8.8 0 16 7.2 16 16s-7.2 16-16 16H112c-8.8 0-16-7.2-16-16s7.2-16 16-16zm0 64H272c8.8 0 16 7.2 16 16s-7.2 16-16 16H112c-8.8 0-16-7.2-16-16s7.2-16 16-16z"/>
      </svg>
    )
  },
  {
    id: 'instances',
    path: '/instances',
    label: 'Instances',
    icon: (
      <svg className="sidebar-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512">
        <path fill="currentColor" d="M64 0C28.7 0 0 28.7 0 64V352c0 35.3 28.7 64 64 64H240l-10.7 32H160c-17.7 0-32 14.3-32 32s14.3 32 32 32H416c17.7 0 32-14.3 32-32s-14.3-32-32-32H346.7L336 416H512c35.3 0 64-28.7 64-64V64c0-35.3-28.7-64-64-64H64zM512 64V288H64V64H512z"/>
      </svg>
    )
  },
  {
    id: 'system',
    path: '/system',
    label: 'System',
    icon: (
      <svg className="sidebar-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
        <path fill="currentColor" d="M495.9 166.6c3.2 8.7 .5 18.4-6.4 24.6l-43.3 39.4c1.1 8.3 1.7 16.8 1.7 25.4s-.6 17.1-1.7 25.4l43.3 39.4c6.9 6.2 9.6 15.9 6.4 24.6c-4.4 11.9-9.7 23.3-15.8 34.3l-4.7 8.1c-6.6 11-14 21.4-22.1 31.2c-5.9 7.2-15.7 9.6-24.5 6.8l-55.7-17.7c-13.4 10.3-28.2 18.9-44 25.4l-12.5 57.1c-2 9.1-9 16.3-18.2 17.8c-13.8 2.3-28 3.5-42.5 3.5s-28.7-1.2-42.5-3.5c-9.2-1.5-16.2-8.7-18.2-17.8l-12.5-57.1c-15.8-6.5-30.6-15.1-44-25.4L83.1 425.9c-8.8 2.8-18.6 .3-24.5-6.8c-8.1-9.8-15.5-20.2-22.1-31.2l-4.7-8.1c-6.1-11-11.4-22.4-15.8-34.3c-3.2-8.7-.5-18.4 6.4-24.6l43.3-39.4C64.6 273.1 64 264.6 64 256s.6-17.1 1.7-25.4L22.4 191.2c-6.9-6.2-9.6-15.9-6.4-24.6c4.4-11.9 9.7-23.3 15.8-34.3l4.7-8.1c6.6-11 14-21.4 22.1-31.2c5.9-7.2 15.7-9.6 24.5-6.8l55.7 17.7c13.4-10.3 28.2-18.9 44-25.4l12.5-57.1c2-9.1 9-16.3 18.2-17.8C227.3 1.2 241.5 0 256 0s28.7 1.2 42.5 3.5c9.2 1.5 16.2 8.7 18.2 17.8l12.5 57.1c15.8 6.5 30.6 15.1 44 25.4l55.7-17.7c8.8-2.8 18.6-.3 24.5 6.8c8.1 9.8 15.5 20.2 22.1 31.2l4.7 8.1c6.1 11 11.4 22.4 15.8 34.3zM256 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160z"/>
      </svg>
    )
  },
  {
    id: 'docs',
    path: '/docs',
    label: 'Docs',
    icon: (
      <svg className="sidebar-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512">
        <path fill="currentColor" d="M96 0C43 0 0 43 0 96V416c0 53 43 96 96 96H384h32c17.7 0 32-14.3 32-32s-14.3-32-32-32V384c17.7 0 32-14.3 32-32V32c0-17.7-14.3-32-32-32H384 96zm0 384H352v64H96c-17.7 0-32-14.3-32-32s14.3-32 32-32zm32-240c0-8.8 7.2-16 16-16H336c8.8 0 16 7.2 16 16s-7.2 16-16 16H144c-8.8 0-16-7.2-16-16zm16 48H336c8.8 0 16 7.2 16 16s-7.2 16-16 16H144c-8.8 0-16-7.2-16-16s7.2-16 16-16z"/>
      </svg>
    )
  },
  {
    id: 'preferences',
    path: '/preferences',
    label: 'Preferences',
    icon: (
      <svg className="sidebar-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
        <path fill="currentColor" d="M495.9 166.6c3.2 8.7 .5 18.4-6.4 24.6l-43.3 39.4c1.1 8.3 1.7 16.8 1.7 25.4s-.6 17.1-1.7 25.4l43.3 39.4c6.9 6.2 9.6 15.9 6.4 24.6c-4.4 11.9-9.7 23.3-15.8 34.3l-4.7 8.1c-6.6 11-14 21.4-22.1 31.2c-5.9 7.2-15.7 9.6-24.5 6.8l-55.7-17.7c-13.4 10.3-28.2 18.9-44 25.4l-12.5 57.1c-2 9.1-9 16.3-18.2 17.8c-13.8 2.3-28 3.5-42.5 3.5s-28.7-1.2-42.5-3.5c-9.2-1.5-16.2-8.7-18.2-17.8l-12.5-57.1c-15.8-6.5-30.6-15.1-44-25.4L83.1 425.9c-8.8 2.8-18.6 .3-24.5-6.8c-8.1-9.8-15.5-20.2-22.1-31.2l-4.7-8.1c-6.1-11-11.4-22.4-15.8-34.3c-3.2-8.7-.5-18.4 6.4-24.6l43.3-39.4C64.6 273.1 64 264.6 64 256s.6-17.1 1.7-25.4L22.4 191.2c-6.9-6.2-9.6-15.9-6.4-24.6c4.4-11.9 9.7-23.3 15.8-34.3l4.7-8.1c6.6-11 14-21.4 22.1-31.2c5.9-7.2 15.7-9.6 24.5-6.8l55.7 17.7c13.4-10.3 28.2-18.9 44-25.4l12.5-57.1c2-9.1 9-16.3 18.2-17.8C227.3 1.2 241.5 0 256 0s28.7 1.2 42.5 3.5c9.2 1.5 16.2 8.7 18.2 17.8l12.5 57.1c15.8 6.5 30.6 15.1 44 25.4l55.7-17.7c8.8-2.8 18.6-.3 24.5 6.8c8.1 9.8 15.5 20.2 22.1 31.2l4.7 8.1c6.1 11 11.4 22.4 15.8 34.3zM256 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160z"/>
      </svg>
    )
  },
];

interface SidebarProviderProps {
  children: ReactNode;
}

export const SidebarProvider: React.FC<SidebarProviderProps> = ({ children }) => {
  const [sidebarItems, setSidebarItems] = useState<SidebarItem[]>(defaultSidebarItems);

  // Load saved order from localStorage on mount
  useEffect(() => {
    try {
      const savedOrder = localStorage.getItem(STORAGE_KEY);
      if (savedOrder) {
        const savedIds = JSON.parse(savedOrder) as string[];
        // Reorder items based on saved order, maintaining any new items
        const reorderedItems = [...defaultSidebarItems].sort((a, b) => {
          const aIndex = savedIds.indexOf(a.id);
          const bIndex = savedIds.indexOf(b.id);

          // If both items are in saved order, use that order
          if (aIndex !== -1 && bIndex !== -1) {
            return aIndex - bIndex;
          }
          // If only one is in saved order, prioritize it
          if (aIndex !== -1) return -1;
          if (bIndex !== -1) return 1;
          // If neither is in saved order, maintain original order
          return 0;
        });

        setSidebarItems(reorderedItems);
      }
    } catch (error) {
      console.warn('Failed to load sidebar order from localStorage:', error);
    }
  }, []);

  const reorderItems = (activeId: string, overId: string) => {
    setSidebarItems((items) => {
      const oldIndex = items.findIndex((item) => item.id === activeId);
      const newIndex = items.findIndex((item) => item.id === overId);

      if (oldIndex === -1 || newIndex === -1) return items;

      const newItems = [...items];
      const [movedItem] = newItems.splice(oldIndex, 1);
      newItems.splice(newIndex, 0, movedItem);

      // Save new order to localStorage
      try {
        const itemIds = newItems.map(item => item.id);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(itemIds));
      } catch (error) {
        console.warn('Failed to save sidebar order to localStorage:', error);
      }

      return newItems;
    });
  };

  const resetOrder = () => {
    setSidebarItems(defaultSidebarItems);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.warn('Failed to remove sidebar order from localStorage:', error);
    }
  };

  return (
    <SidebarContext.Provider value={{ sidebarItems, reorderItems, resetOrder }}>
      {children}
    </SidebarContext.Provider>
  );
};

export const useSidebar = (): SidebarContextType => {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
};
