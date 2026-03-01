import { useState } from 'react';
import { useAgentStore, AgentSession } from '../../hooks/useAgentStore';
import {
  GitBranch,
  GitMerge,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import clsx from 'clsx';

interface WorktreePanelProps {
  session: AgentSession;
  worktree: any;
}

export default function WorktreePanel({ session, worktree }: WorktreePanelProps) {
  const { mergeWorktree } = useAgentStore();
  const [isMerging, setIsMerging] = useState(false);

  const handleMerge = async () => {
    setIsMerging(true);
    try {
      await mergeWorktree(session.id);
    } catch (err) {
      console.error('Merge failed:', err);
    } finally {
      setIsMerging(false);
    }
  };

  if (!worktree) {
    return (
      <div className="text-center py-8 text-surface-500">
        <GitBranch className="w-12 h-12 mx-auto mb-3 text-surface-300" />
        <p>No worktree configured for this session</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-surface-200 p-4">
        <h4 className="font-medium text-surface-900 mb-3">Worktree Info</h4>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-surface-500">Branch:</span>
            <span className="font-mono text-surface-900">{worktree.branchName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-surface-500">Base Branch:</span>
            <span className="font-mono text-surface-900">{worktree.baseBranch}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-surface-500">Path:</span>
            <span className="font-mono text-surface-900 truncate max-w-xs">{worktree.worktreePath}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-surface-500">Status:</span>
            <span className={clsx(
              'px-2 py-0.5 rounded-full text-xs',
              worktree.status === 'active' && 'bg-green-100 text-green-700',
              worktree.status === 'merged' && 'bg-blue-100 text-blue-700',
              worktree.status === 'conflict' && 'bg-red-100 text-red-700'
            )}>
              {worktree.status}
            </span>
          </div>
        </div>
      </div>

      {worktree.status === 'active' && session.status === 'completed' && (
        <button
          onClick={handleMerge}
          disabled={isMerging}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50"
        >
          {isMerging ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitMerge className="w-4 h-4" />}
          Merge to {worktree.baseBranch}
        </button>
      )}

      {worktree.conflictFiles?.length > 0 && (
        <div className="bg-red-50 rounded-lg border border-red-200 p-4">
          <h4 className="font-medium text-red-800 mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Merge Conflicts ({worktree.conflictFiles.length})
          </h4>
          <ul className="space-y-1">
            {worktree.conflictFiles.map((file: string) => (
              <li key={file} className="text-sm font-mono text-red-700">{file}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
