import { useState } from 'react';
import { api } from '../api.js';
import Avatar from './Avatar.jsx';
import Modal from './Modal.jsx';
import { PRIORITIES, STATUSES, formatDate, isOverdue } from '../utils.js';

export default function TaskBoard({ projectId, tasks, setTasks, members, me }) {
  const [editingTask, setEditingTask] = useState(null); // null | 'new' | task
  const [newStatus, setNewStatus] = useState('todo');
  const [onlyMine, setOnlyMine] = useState(false);
  const [dragOver, setDragOver] = useState(null);
  const [error, setError] = useState('');

  const visible = onlyMine ? tasks.filter((t) => t.assigneeId === me.userId) : tasks;

  // Optimistic status change: update the UI first, roll back if the API call fails.
  async function moveTask(taskId, status) {
    const previous = tasks;
    const task = tasks.find((t) => t.taskId === taskId);
    if (!task || task.status === status) return;
    setTasks(tasks.map((t) => (t.taskId === taskId ? { ...t, status } : t)));
    try {
      const updated = await api.patch(`/projects/${projectId}/tasks/${taskId}`, { status });
      setTasks((current) => current.map((t) => (t.taskId === taskId ? updated : t)));
      setError('');
    } catch (err) {
      setTasks(previous);
      setError(err.message);
    }
  }

  function openNew(status) {
    setNewStatus(status);
    setEditingTask('new');
  }

  return (
    <>
      <div className="toolbar">
        <label className="checkbox">
          <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
          Only my tasks
        </label>
        <button className="btn btn-primary" onClick={() => openNew('todo')}>+ Add task</button>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="board">
        {STATUSES.map((col) => {
          const colTasks = visible.filter((t) => t.status === col.id);
          return (
            <section
              key={col.id}
              className={`column column-${col.id} ${dragOver === col.id ? 'drag-over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(col.id);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                moveTask(e.dataTransfer.getData('text/plain'), col.id);
              }}
            >
              <header className="column-header">
                <h3>{col.label}</h3>
                <span className="count">{colTasks.length}</span>
              </header>
              <div className="column-body">
                {colTasks.map((task) => (
                  <TaskCard key={task.taskId} task={task} onOpen={() => setEditingTask(task)} onMove={moveTask} />
                ))}
                {colTasks.length === 0 && <p className="column-empty">Drop tasks here</p>}
              </div>
              <button className="add-inline" onClick={() => openNew(col.id)}>+ Add task</button>
            </section>
          );
        })}
      </div>

      {editingTask && (
        <TaskModal
          projectId={projectId}
          task={editingTask === 'new' ? null : editingTask}
          defaultStatus={newStatus}
          members={members}
          onClose={() => setEditingTask(null)}
          onSaved={(saved) => {
            setTasks((current) =>
              current.some((t) => t.taskId === saved.taskId)
                ? current.map((t) => (t.taskId === saved.taskId ? saved : t))
                : [...current, saved],
            );
            setEditingTask(null);
          }}
          onDeleted={(taskId) => {
            setTasks((current) => current.filter((t) => t.taskId !== taskId));
            setEditingTask(null);
          }}
        />
      )}
    </>
  );
}

function TaskCard({ task, onOpen, onMove }) {
  const overdue = isOverdue(task);
  return (
    <article
      className="task-card"
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', task.taskId)}
      onClick={onOpen}
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <div className="task-card-top">
        <span className={`priority priority-${task.priority}`}>{task.priority}</span>
        {task.dueDate && (
          <span className={`due ${overdue ? 'overdue' : ''}`}>
            {overdue ? 'Overdue · ' : ''}
            {formatDate(task.dueDate)}
          </span>
        )}
      </div>
      <h4>{task.title}</h4>
      {task.description && <p className="muted clamp small">{task.description}</p>}
      <div className="task-card-bottom">
        {task.assigneeName ? (
          <span className="assignee">
            <Avatar name={task.assigneeName} size={22} />
            {task.assigneeName}
          </span>
        ) : (
          <span className="muted small">Unassigned</span>
        )}
        {/* Dropdown alternative to drag-and-drop (works on phones too) */}
        <select
          className="status-select"
          value={task.status}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => onMove(task.taskId, e.target.value)}
          aria-label="Change status"
        >
          {STATUSES.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>
    </article>
  );
}

function TaskModal({ projectId, task, defaultStatus, members, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState({
    title: task?.title || '',
    description: task?.description || '',
    status: task?.status || defaultStatus,
    priority: task?.priority || 'medium',
    assigneeId: task?.assigneeId || '',
    dueDate: task?.dueDate || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  // Keep a former member selectable so editing an old task doesn't silently unassign it.
  const assigneeMissing = form.assigneeId && !members.some((m) => m.userId === form.assigneeId);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const payload = {
      ...form,
      assigneeId: form.assigneeId || null,
      dueDate: form.dueDate || null,
    };
    try {
      const saved = task
        ? await api.patch(`/projects/${projectId}/tasks/${task.taskId}`, payload)
        : await api.post(`/projects/${projectId}/tasks`, {
            ...payload,
            assigneeId: payload.assigneeId || undefined,
            dueDate: payload.dueDate || undefined,
          });
      onSaved(saved);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this task?')) return;
    setSaving(true);
    try {
      await api.del(`/projects/${projectId}/tasks/${task.taskId}`);
      onDeleted(task.taskId);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal title={task ? 'Edit task' : 'New task'} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <label>
          Title
          <input value={form.title} onChange={update('title')} maxLength={150} required autoFocus />
        </label>
        <label>
          Description
          <textarea value={form.description} onChange={update('description')} maxLength={2000} rows={4} />
        </label>
        <div className="form-row">
          <label>
            Status
            <select value={form.status} onChange={update('status')}>
              {STATUSES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select value={form.priority} onChange={update('priority')}>
              {PRIORITIES.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>
            Assignee
            <select value={form.assigneeId} onChange={update('assigneeId')}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{m.name}</option>
              ))}
              {assigneeMissing && (
                <option value={form.assigneeId}>{task?.assigneeName} (no longer a member)</option>
              )}
            </select>
          </label>
          <label>
            Due date
            <input type="date" value={form.dueDate} onChange={update('dueDate')} />
          </label>
        </div>
        {task && (
          <p className="tiny muted">
            Created by {task.createdByName} on {formatDate(task.createdAt)}
          </p>
        )}
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          {task && (
            <button type="button" className="btn btn-danger push-left" onClick={remove} disabled={saving}>
              Delete
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !form.title.trim()}>
            {saving ? 'Saving…' : task ? 'Save changes' : 'Create task'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
