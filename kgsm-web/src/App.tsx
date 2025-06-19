import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Provider } from 'react-redux';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import Header from './components/layout/Header';
import { HomePage, InstancesPage, BlueprintsPage, SystemPage } from './pages';
import store from './store';

/**
 * Main application component
 */
const App: React.FC = () => {
  return (
    <Provider store={store}>
      <ThemeProvider>
        <AuthProvider>
          <Router>
            <div className="app-container">
              <Header />
              <div className="main-content">
                <div className="content-area">
                  <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/instances" element={<InstancesPage />} />
                    <Route path="/blueprints" element={<BlueprintsPage />} />
                    <Route path="/system" element={<SystemPage />} />
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
