import { useState } from 'react';
import { api } from '../api.js';
import Avatar from './Avatar.jsx';
import { formatDate } from '../utils.js';

export default function MembersPanel({ projectId, members, setMembers, me, isOwner, onLeft }) {
  const [email, setEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function addMember(e) {
    e.preventDefault();
    setAdding(true);
    setError('');
    setNotice('');
    try {
      const member = await api.post(`/projects/${projectId}/members`, { email });
      setMembers([...members, member]);
      setNotice(`${member.name} was added to the project.`);
      setEmail('');
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function removeMember(member) {
    const leaving = member.userId === me.userId;
    const question = leaving ? 'Leave this project?' : `Remove ${member.name} from this project?`;
    if (!window.confirm(question)) return;
    try {
      await api.del(`/projects/${projectId}/members/${member.userId}`);
      if (leaving) onLeft();
      else setMembers(members.filter((m) => m.userId !== member.userId));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="panel">
      {isOwner && (
        <form onSubmit={addMember} className="invite-form">
          <input
            type="email"
            placeholder="Teammate's email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <button className="btn btn-primary" disabled={adding}>{adding ? 'Adding…' : 'Add member'}</button>
        </form>
      )}
      {isOwner && <p className="tiny muted">Teammates need to sign up for CloudDesk once before you can add them.</p>}
      {notice && <p className="success">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <ul className="member-list">
        {members.map((m) => (
          <li key={m.userId}>
            <Avatar name={m.name} size={36} />
            <div className="member-info">
              <strong>
                {m.name}
                {m.userId === me.userId && <span className="muted"> (you)</span>}
              </strong>
              <span className="muted small">{m.email}</span>
            </div>
            <span className="muted tiny">Joined {formatDate(m.joinedAt)}</span>
            <span className={`badge ${m.role === 'owner' ? 'badge-primary' : ''}`}>{m.role}</span>
            {m.role !== 'owner' && (isOwner || m.userId === me.userId) && (
              <button className="btn btn-small btn-danger" onClick={() => removeMember(m)}>
                {m.userId === me.userId ? 'Leave' : 'Remove'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
