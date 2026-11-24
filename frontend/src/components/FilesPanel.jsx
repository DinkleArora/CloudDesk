import { useEffect, useRef, useState } from 'react';
import { api, uploadFile } from '../api.js';
import { formatBytes, formatDate } from '../utils.js';

const MAX_MB = 25;

export default function FilesPanel({ projectId, me, isOwner }) {
  const [files, setFiles] = useState(null);
  const [uploads, setUploads] = useState([]); // { id, name, progress, error }
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    api
      .get(`/projects/${projectId}/files`)
      .then(setFiles)
      .catch((err) => setError(err.message));
  }, [projectId]);

  const patchUpload = (id, changes) =>
    setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...changes } : u)));

  async function handleFiles(fileList) {
    for (const file of Array.from(fileList)) {
      const id = `${Date.now()}-${Math.random()}`;
      setUploads((list) => [...list, { id, name: file.name, progress: 0, error: '' }]);
      if (file.size > MAX_MB * 1024 * 1024) {
        patchUpload(id, { error: `Larger than ${MAX_MB} MB` });
        continue;
      }
      try {
        const saved = await uploadFile(projectId, file, (progress) => patchUpload(id, { progress }));
        setFiles((list) => [saved, ...(list || [])]);
        setUploads((list) => list.filter((u) => u.id !== id));
      } catch (err) {
        patchUpload(id, { error: err.message });
      }
    }
    if (inputRef.current) inputRef.current.value = '';
  }

  async function download(file) {
    try {
      const { downloadUrl } = await api.get(`/projects/${projectId}/files/${file.fileId}/download-url`);
      window.location.assign(downloadUrl);
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(file) {
    if (!window.confirm(`Delete "${file.fileName}"?`)) return;
    try {
      await api.del(`/projects/${projectId}/files/${file.fileId}`);
      setFiles((list) => list.filter((f) => f.fileId !== file.fileId));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="panel">
      <div
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
      >
        <strong>Drop files here or click to upload</strong>
        <span className="muted small">Up to {MAX_MB} MB per file · stored securely in Amazon S3</span>
        <input ref={inputRef} type="file" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
      </div>

      {uploads.map((u) => (
        <div key={u.id} className="upload-row">
          <span className="upload-name">{u.name}</span>
          {u.error ? (
            <>
              <span className="error small">{u.error}</span>
              <button
                className="icon-btn"
                onClick={() => setUploads((list) => list.filter((x) => x.id !== u.id))}
                aria-label="Dismiss"
              >
                ×
              </button>
            </>
          ) : (
            <div className="progress-bar slim">
              <div className="progress-fill" style={{ width: `${u.progress}%` }} />
            </div>
          )}
        </div>
      ))}

      {error && <p className="error">{error}</p>}
      {!files && !error && <div className="spinner" aria-label="Loading" />}
      {files && files.length === 0 && <p className="muted center">No files shared yet.</p>}

      {files && files.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Size</th>
              <th>Uploaded by</th>
              <th>Date</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.fileId}>
                <td className="file-name">{f.fileName}</td>
                <td>{formatBytes(f.size)}</td>
                <td>{f.uploadedByName}</td>
                <td>{formatDate(f.uploadedAt)}</td>
                <td className="row-actions">
                  <button className="btn btn-small" onClick={() => download(f)}>Download</button>
                  {(isOwner || f.uploadedBy === me.userId) && (
                    <button className="btn btn-small btn-danger" onClick={() => remove(f)}>Delete</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
