import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import Header from './components/layout/Header';
import BlueprintList from './components/blueprints/BlueprintList';
import InstanceList from './components/instances/InstanceList';
import SystemMetrics from './components/graphs/SystemMetrics';
import './App.css';

/**
 * Main application component
 */
const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router>
          <div className="app-container">
            <Header />
            <div className="main-content">
              <div className="content-area">
                <Routes>
                  <Route
                    path="/"
                    element={
                      <>
                        <SystemMetrics />
                        <BlueprintList />
                        <InstanceList />
                      </>
                    }
                  />
                </Routes>
              </div>
            </div>
          </div>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
};

export default App;
