import React, { useState } from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import { Provider } from 'react-redux';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { SidebarProvider } from './contexts/SidebarContext';
import Header from './components/layout/Header';
import Sidebar from './components/layout/Sidebar';
import Footer from './components/layout/Footer';
import PageTransition from './components/common/PageTransition';
import { useDataPrefetch } from './hooks/useDataPrefetch';
import store from './store';

/**
 * App content component that uses the prefetch hook
 * Separated to ensure Redux store is available
 */
const AppContent: React.FC = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Prefetch data when app loads
  useDataPrefetch();

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  return (
    <ThemeProvider>
      <AuthProvider>
        <SidebarProvider>
          <Router>
            <div className="app-container">
              <Header
                isSidebarOpen={isSidebarOpen}
                onSidebarToggle={toggleSidebar}
              />
              <Sidebar
                isOpen={isSidebarOpen}
                onToggle={toggleSidebar}
              />
              <div className="main-content">
                <div className="content-area">
                  <PageTransition />
                </div>
                <Footer />
              </div>
            </div>
          </Router>
        </SidebarProvider>
      </AuthProvider>
    </ThemeProvider>
  );
};

/**
 * Main application component
 */
const App: React.FC = () => {
  return (
    <Provider store={store}>
      <AppContent />
    </Provider>
  );
};

export default App;
