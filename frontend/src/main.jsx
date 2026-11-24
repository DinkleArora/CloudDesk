import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Amplify } from 'aws-amplify';
import '@aws-amplify/ui-react/styles.css';
import './styles.css';
import App from './App.jsx';
import { config, missingConfig } from './config.js';

const root = ReactDOM.createRoot(document.getElementById('root'));

if (missingConfig.length) {
  root.render(
    <div className="config-error">
      <h1>CloudDesk is not configured</h1>
      <p>Set these environment variables (see <code>frontend/.env.example</code>):</p>
      <ul>
        {missingConfig.map((key) => (
          <li key={key}>
            <code>{key}</code>
          </li>
        ))}
      </ul>
    </div>,
  );
} else {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.userPoolId,
        userPoolClientId: config.userPoolClientId,
        loginWith: { email: true },
        signUpVerificationMethod: 'code',
      },
    },
  });

  root.render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  );
}
