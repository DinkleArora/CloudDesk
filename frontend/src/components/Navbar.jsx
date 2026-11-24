import { Link } from 'react-router-dom';
import Avatar from './Avatar.jsx';

export default function Navbar({ me, onSignOut }) {
  return (
    <header className="navbar">
      <div className="container navbar-inner">
        <Link to="/" className="brand">
          <span className="logo-mark small">☁</span>
          CloudDesk
        </Link>
        <div className="navbar-right">
          <Avatar name={me.name} />
          <span className="navbar-name">{me.name}</span>
          <button className="btn btn-ghost" onClick={onSignOut}>Sign out</button>
        </div>
      </div>
    </header>
  );
}
