import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Provider } from 'react-redux';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import Header from './components/layout/Header';
import Sidebar from './components/layout/Sidebar';
import { HomePage, InstancesPage, BlueprintsPage, SystemPage, DocsPage } from './pages';
import store from './store';

/**
 * Main application component
 */
const App: React.FC = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  return (
    <Provider store={store}>
      <ThemeProvider>
        <AuthProvider>
          <Router>
            <div className="app-container">
              <Header
                isSidebarOpen={isSidebarOpen}
                onSidebarToggle={toggleSidebar}
              />
              <div className="main-content">
                <Sidebar
                  isOpen={isSidebarOpen}
                  onToggle={toggleSidebar}
                />
                <div className="content-area">
                  <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/instances" element={<InstancesPage />} />
                    <Route path="/blueprints" element={<BlueprintsPage />} />
                    <Route path="/system" element={<SystemPage />} />
                    <Route path="/docs" element={<DocsPage />} />
                  </Routes>
                </div>
              </div>
            </div>
          </Router>
        </AuthProvider>
      </ThemeProvider>
    </Provider>
  );
};

export default App;
