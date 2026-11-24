import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Authenticator } from '@aws-amplify/ui-react';
import { api } from './api.js';
import Navbar from './components/Navbar.jsx';
import ProjectsPage from './pages/ProjectsPage.jsx';
import ProjectPage from './pages/ProjectPage.jsx';

const authComponents = {
  Header() {
    return (
      <div className="auth-header">
        <div className="logo-mark">☁</div>
        <h1>CloudDesk</h1>
        <p>Bringing Teams, Tasks, and Ideas Together</p>
      </div>
    );
  },
};

export default function App() {
  return (
    <Authenticator loginMechanisms={['email']} signUpAttributes={['name']} components={authComponents}>
      {({ signOut, user }) => <Shell signOut={signOut} userId={user?.userId} />}
    </Authenticator>
  );
}

function Shell({ signOut, userId }) {
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');

  // Register/refresh the profile so teammates can find this user by email.
  useEffect(() => {
    let cancelled = false;
    setError('');
    api
      .post('/me')
      .then((profile) => !cancelled && setMe(profile))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (error) {
    return (
      <div className="center-screen">
        <div className="card">
          <h2>Could not reach the CloudDesk API</h2>
          <p className="error">{error}</p>
          <button className="btn" onClick={signOut}>Sign out</button>
        </div>
      </div>
    );
  }
  if (!me) return <div className="center-screen spinner" aria-label="Loading" />;

  return (
    <div className="app">
      <Navbar me={me} onSignOut={signOut} />
      <main className="container">
        <Routes>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectPage me={me} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
