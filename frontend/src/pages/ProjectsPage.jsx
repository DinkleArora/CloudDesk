import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';
import { formatDate } from '../utils.js';

export default function ProjectsPage() {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    api
      .get('/projects')
      .then(setProjects)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Your projects</h1>
          <p className="muted">Create a workspace for each project and invite your teammates.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New project</button>
      </div>

      {error && <p className="error">{error}</p>}
      {!projects && !error && <div className="spinner" aria-label="Loading" />}

      {projects && projects.length === 0 && (
        <div className="empty-state">
          <h2>No projects yet</h2>
          <p>Create your first project to start assigning tasks and sharing files.</p>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>Create a project</button>
        </div>
      )}

      {projects && projects.length > 0 && (
        <div className="project-grid">
          {projects.map((p) => (
            <Link key={p.projectId} to={`/projects/${p.projectId}`} className="project-card">
              <div className="project-card-top">
                <h3>{p.name}</h3>
                <span className={`badge ${p.myRole === 'owner' ? 'badge-primary' : ''}`}>{p.myRole}</span>
              </div>
              <p className="muted clamp">{p.description || 'No description'}</p>
              <p className="tiny muted">Created {formatDate(p.createdAt)} by {p.ownerName}</p>
            </Link>
          ))}
        </div>
      )}

      {showCreate && <CreateProjectModal onClose={() => setShowCreate(false)} />}
    </>
  );
}

function CreateProjectModal({ onClose }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const project = await api.post('/projects', { name, description });
      navigate(`/projects/${project.projectId}`);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal title="New project" onClose={onClose}>
      <form onSubmit={submit} className="form">
        <label>
          Project name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required autoFocus />
        </label>
        <label>
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
            rows={4}
            placeholder="What is this project about?"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !name.trim()}>
            {saving ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
