import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import TaskBoard from '../components/TaskBoard.jsx';
import FilesPanel from '../components/FilesPanel.jsx';
import MembersPanel from '../components/MembersPanel.jsx';
import Modal from '../components/Modal.jsx';

const TABS = [
  { id: 'board', label: 'Task board' },
  { id: 'files', label: 'Files' },
  { id: 'members', label: 'Members' },
];

export default function ProjectPage({ me }) {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [members, setMembers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [tab, setTab] = useState('board');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [details, taskList] = await Promise.all([
        api.get(`/projects/${projectId}`),
        api.get(`/projects/${projectId}/tasks`),
      ]);
      setProject(details.project);
      setMembers(details.members);
      setTasks(taskList);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [projectId]);

  useEffect(() => {
    setProject(null);
    load();
  }, [load]);

  if (error && !project) {
    return (
      <div className="empty-state">
        <h2>Project unavailable</h2>
        <p className="error">{error}</p>
        <Link to="/" className="btn">Back to projects</Link>
      </div>
    );
  }
  if (!project) return <div className="spinner" aria-label="Loading" />;

  const isOwner = project.myRole === 'owner';
  const done = tasks.filter((t) => t.status === 'done').length;
  const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  async function deleteProject() {
    if (!window.confirm(`Delete "${project.name}"? All tasks and files will be permanently removed.`)) return;
    try {
      await api.del(`/projects/${projectId}`);
      navigate('/');
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <>
      <Link to="/" className="back-link">← All projects</Link>
      <div className="page-header">
        <div>
          <h1>{project.name}</h1>
          {project.description && <p className="muted">{project.description}</p>}
        </div>
        {isOwner && (
          <div className="header-actions">
            <button className="btn" onClick={() => setEditing(true)}>Edit</button>
            <button className="btn btn-danger" onClick={deleteProject}>Delete</button>
          </div>
        )}
      </div>

      <div className="progress-card">
        <div className="progress-text">
          <strong>{progress}% complete</strong>
          <span className="muted">
            {done} of {tasks.length} tasks done · {members.length} member{members.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'board' && (
        <TaskBoard projectId={projectId} tasks={tasks} setTasks={setTasks} members={members} me={me} />
      )}
      {tab === 'files' && <FilesPanel projectId={projectId} me={me} isOwner={isOwner} />}
      {tab === 'members' && (
        <MembersPanel
          projectId={projectId}
          members={members}
          setMembers={setMembers}
          me={me}
          isOwner={isOwner}
          onLeft={() => navigate('/')}
        />
      )}

      {editing && (
        <EditProjectModal
          project={project}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setProject(updated);
            setEditing(false);
          }}
        />
      )}
    </>
  );
}

function EditProjectModal({ project, onClose, onSaved }) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      onSaved(await api.patch(`/projects/${project.projectId}`, { name, description }));
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal title="Edit project" onClose={onClose}>
      <form onSubmit={submit} className="form">
        <label>
          Project name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
        </label>
        <label>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={4} />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
