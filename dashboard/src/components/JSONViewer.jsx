export default function JSONViewer({ title, data }) {
  return (
    <div className="bg-nooterra-dark border border-nooterra-border rounded-lg overflow-hidden">
      <div className="px-4 py-2 bg-nooterra-border/50 border-b border-nooterra-border">
        <p className="text-sm text-gray-400">{title}</p>
      </div>
      <pre className="p-4 text-xs text-green-300 overflow-x-auto max-h-72">{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}

