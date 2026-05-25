/**
 * FileUpload.jsx
 * Purpose: Drag-and-drop file upload with validation and progress
 * Author: TraceLens
 */

import React, { useState, useRef } from 'react';
import './FileUpload.css';

const ALLOWED_EXTENSIONS = ['.trc', '.tracesql', '.log', '.txt'];
const MAX_SIZE_MB = 1024;

function FileUpload({ onUpload, disabled }) {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);

  const validateFile = (file) => {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return `Invalid file type: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return `File too large: ${(file.size / 1024 / 1024).toFixed(0)}MB. Maximum: ${MAX_SIZE_MB}MB`;
    }
    return null;
  };

  const formatSize = (bytes) => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
  };

  const handleFile = (file) => {
    setError('');
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleInputChange = (e) => {
    if (e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    setError('');
    try {
      await onUpload(selectedFile);
    } catch (err) {
      setError(err.message);
      setUploading(false);
    }
  };

  return (
    <div className="file-upload-container">
      <div className="file-upload-header">
        <h1>Analyze PeopleCode Trace</h1>
        <p>Drop a trace file to get performance insights, SQL analysis, and AI-powered recommendations</p>
      </div>

      <div
        className={`drop-zone ${dragOver ? 'drag-over' : ''} ${selectedFile ? 'has-file' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleClick}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".trc,.tracesql,.log,.txt"
          onChange={handleInputChange}
          hidden
        />

        {!selectedFile ? (
          <>
            <svg className="upload-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p className="drop-text">Drag & drop trace file here</p>
            <p className="drop-subtext">or click to browse</p>
            <p className="drop-formats">.trc .tracesql .log .txt — up to 1GB</p>
          </>
        ) : (
          <div className="file-info">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <div className="file-details">
              <span className="file-name">{selectedFile.name}</span>
              <span className="file-size">{formatSize(selectedFile.size)}</span>
              <span className="file-type">{selectedFile.name.split('.').pop().toUpperCase()}</span>
            </div>
          </div>
        )}
      </div>

      {error && <div className="upload-error">{error}</div>}

      {selectedFile && (
        <div className="upload-actions">
          <button
            className="btn-analyze"
            onClick={handleUpload}
            disabled={uploading || disabled}
          >
            {disabled ? 'Waiting for connection...' : uploading ? 'Uploading...' : 'Analyze Trace'}
          </button>
          <button
            className="btn-clear"
            onClick={() => { setSelectedFile(null); setError(''); }}
            disabled={uploading}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

export default FileUpload;
