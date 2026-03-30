import React, { useState, useRef, useCallback } from "react";
import { workerApiRequest } from "../shared.js";

const ACCEPTED_TYPES = {
  "application/pdf": "pdf",
  "text/csv": "csv",
  "application/json": "json",
  "text/plain": "txt",
  "text/markdown": "md",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const ACCEPTED_EXTENSIONS = new Set(["pdf", "csv", "json", "txt", "md", "png", "jpg", "jpeg", "gif", "webp"]);

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function fileIcon(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "\u{1F5BC}";
  if (ext === "pdf") return "\u{1F4C4}";
  if (ext === "csv") return "\u{1F4CA}";
  if (ext === "json") return "\u{1F4CB}";
  return "\u{1F4C3}";
}

const styles = {
  container: {
    marginBottom: 24,
  },
  label: {
    fontSize: "11px",
    fontWeight: 600,
    color: "var(--text-tertiary)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 8,
    display: "block",
  },
  dropZone: {
    position: "relative",
    border: "2px dashed var(--border)",
    borderRadius: 12,
    padding: "28px 20px",
    textAlign: "center",
    cursor: "pointer",
    transition: "border-color 200ms, background 200ms",
    background: "transparent",
  },
  dropZoneActive: {
    borderColor: "var(--accent)",
    background: "rgba(196, 97, 58, 0.04)",
  },
  dropIcon: {
    display: "block",
    margin: "0 auto 8px",
    opacity: 0.5,
  },
  dropText: {
    fontSize: "14px",
    fontWeight: 500,
    color: "var(--text-secondary)",
    marginBottom: 4,
  },
  dropSubtext: {
    fontSize: "12px",
    color: "var(--text-tertiary)",
  },
  browseLink: {
    color: "var(--accent)",
    cursor: "pointer",
    textDecoration: "underline",
  },
  fileList: {
    marginTop: 12,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  fileRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderRadius: 8,
    background: "var(--bg-surface, var(--bg-400))",
    border: "1px solid var(--border)",
    fontSize: "13px",
  },
  fileName: {
    flex: 1,
    fontWeight: 500,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  fileMeta: {
    fontSize: "11px",
    color: "var(--text-tertiary)",
    flexShrink: 0,
  },
  progressBar: {
    height: 3,
    borderRadius: 2,
    background: "var(--bg-300)",
    marginTop: 4,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 2,
    background: "var(--accent)",
    transition: "width 200ms ease-out",
  },
  statusDot: (color) => ({
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: color,
    flexShrink: 0,
  }),
  error: {
    fontSize: "12px",
    color: "var(--red, #c43a3a)",
    marginTop: 4,
  },
  downloadLink: {
    fontSize: "12px",
    color: "var(--accent)",
    textDecoration: "none",
    flexShrink: 0,
    cursor: "pointer",
  },
};

export default function FileUploadZone({ workerId, addToast }) {
  const [files, setFiles] = useState([]);
  const [uploads, setUploads] = useState([]); // { id, filename, progress, status, error }
  const [dragOver, setDragOver] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const inputRef = useRef(null);

  // Load existing files on first render
  const loadFiles = useCallback(async () => {
    if (loaded) return;
    setLoadingFiles(true);
    try {
      const result = await workerApiRequest({
        pathname: `/v1/workers/${encodeURIComponent(workerId)}/files`,
        method: "GET",
      });
      setFiles(result?.files || []);
    } catch {
      setFiles([]);
    }
    setLoadingFiles(false);
    setLoaded(true);
  }, [workerId, loaded]);

  // Load files when component mounts
  React.useEffect(() => { loadFiles(); }, [loadFiles]);

  function validateFile(file) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!ACCEPTED_EXTENSIONS.has(ext)) {
      return `Unsupported file type: .${ext}`;
    }
    if (file.size > MAX_FILE_SIZE) {
      return `File too large (max ${formatBytes(MAX_FILE_SIZE)})`;
    }
    return null;
  }

  async function uploadFile(file) {
    const uploadId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const entry = { id: uploadId, filename: file.name, progress: 0, status: "uploading", error: null };
    setUploads(prev => [...prev, entry]);

    const validationError = validateFile(file);
    if (validationError) {
      setUploads(prev => prev.map(u => u.id === uploadId ? { ...u, status: "error", error: validationError } : u));
      return;
    }

    try {
      // 1. Get presigned URL from backend
      const presignResult = await workerApiRequest({
        pathname: `/v1/workers/${encodeURIComponent(workerId)}/files`,
        method: "POST",
        body: {
          filename: file.name,
          content_type: file.type || "application/octet-stream",
          size: file.size,
        },
      });

      if (!presignResult?.upload_url) {
        throw new Error(presignResult?.error || "Failed to get upload URL");
      }

      setUploads(prev => prev.map(u => u.id === uploadId ? { ...u, progress: 30 } : u));

      // 2. Upload directly to S3 via presigned URL
      const uploadResp = await fetch(presignResult.upload_url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });

      if (!uploadResp.ok) {
        throw new Error(`Upload failed: ${uploadResp.status}`);
      }

      setUploads(prev => prev.map(u => u.id === uploadId ? { ...u, progress: 100, status: "done" } : u));

      // 3. Add to file list
      setFiles(prev => [{
        id: presignResult.file_id,
        filename: file.name,
        content_type: file.type,
        size_bytes: file.size,
        created_at: new Date().toISOString(),
        download_url: null,
      }, ...prev]);

      if (addToast) addToast({ message: `Uploaded ${file.name}`, type: "success" });

      // Remove upload entry after a delay
      setTimeout(() => {
        setUploads(prev => prev.filter(u => u.id !== uploadId));
      }, 3000);

    } catch (e) {
      setUploads(prev => prev.map(u => u.id === uploadId ? { ...u, status: "error", error: e?.message || "Upload failed" } : u));
      if (addToast) addToast({ message: `Failed to upload ${file.name}`, type: "error" });
    }
  }

  function handleFiles(fileList) {
    for (const file of fileList) {
      uploadFile(file);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) {
      handleFiles(e.dataTransfer.files);
    }
  }

  function handleDragOver(e) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    setDragOver(false);
  }

  function handleInputChange(e) {
    if (e.target.files?.length) {
      handleFiles(e.target.files);
      e.target.value = "";
    }
  }

  return (
    <div style={styles.container}>
      <span style={styles.label}>Files</span>

      {/* Drop zone */}
      <div
        style={{ ...styles.dropZone, ...(dragOver ? styles.dropZoneActive : {}) }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
      >
        <svg style={styles.dropIcon} width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <div style={styles.dropText}>
          Drop files here or <span style={styles.browseLink}>browse</span>
        </div>
        <div style={styles.dropSubtext}>
          PDF, CSV, JSON, TXT, images (max {formatBytes(MAX_FILE_SIZE)})
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={Object.keys(ACCEPTED_TYPES).join(",")}
          onChange={handleInputChange}
          style={{ display: "none" }}
        />
      </div>

      {/* Active uploads */}
      {uploads.length > 0 && (
        <div style={styles.fileList}>
          {uploads.map(u => (
            <div key={u.id} style={styles.fileRow}>
              <span>{fileIcon(u.filename)}</span>
              <span style={styles.fileName}>{u.filename}</span>
              {u.status === "uploading" && (
                <div style={{ flex: "0 0 80px" }}>
                  <div style={styles.progressBar}>
                    <div style={{ ...styles.progressFill, width: `${u.progress}%` }} />
                  </div>
                </div>
              )}
              {u.status === "done" && <div style={styles.statusDot("var(--green, #5bb98c)")} />}
              {u.status === "error" && (
                <>
                  <div style={styles.statusDot("var(--red, #c43a3a)")} />
                  <span style={styles.error}>{u.error}</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Existing files */}
      {loadingFiles && (
        <div style={{ marginTop: 12, fontSize: "13px", color: "var(--text-tertiary)" }}>Loading files...</div>
      )}

      {!loadingFiles && files.length > 0 && (
        <div style={styles.fileList}>
          {files.map(f => (
            <div key={f.id} style={styles.fileRow}>
              <span>{fileIcon(f.filename)}</span>
              <span style={styles.fileName}>{f.filename}</span>
              <span style={styles.fileMeta}>{formatBytes(f.size_bytes || 0)}</span>
              {f.download_url && (
                <a href={f.download_url} target="_blank" rel="noopener noreferrer" style={styles.downloadLink} onClick={e => e.stopPropagation()}>
                  Download
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {!loadingFiles && files.length === 0 && uploads.length === 0 && (
        <div style={{ marginTop: 8, fontSize: "12px", color: "var(--text-tertiary)" }}>
          No files uploaded yet. Upload files to give your worker additional context.
        </div>
      )}
    </div>
  );
}
