import { AgentSession } from '../../hooks/useAgentStore';
import { formatDuration } from './constants';

interface ConfigPanelProps {
  session: AgentSession;
}

export default function ConfigPanel({ session }: ConfigPanelProps) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-surface-200 p-4">
        <h4 className="font-medium text-surface-900 mb-3">Session Configuration</h4>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-surface-500">Max Iterations:</span>
            <span className="text-surface-900">{session.maxIterations}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-surface-500">Timeout:</span>
            <span className="text-surface-900">{formatDuration(session.timeoutSeconds)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-surface-500">Auto Commit:</span>
            <span className="text-surface-900">{session.config?.autoCommit ? 'Yes' : 'No'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-surface-500">Run Tests:</span>
            <span className="text-surface-900">{session.config?.runTests ? 'Yes' : 'No'}</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-surface-200 p-4">
        <h4 className="font-medium text-surface-900 mb-3">Task Specification</h4>
        <pre className="text-sm text-surface-700 whitespace-pre-wrap bg-surface-50 p-3 rounded-lg">
          {session.taskSpecification}
        </pre>
      </div>

      {session.systemPrompt && (
        <div className="bg-white rounded-lg border border-surface-200 p-4">
          <h4 className="font-medium text-surface-900 mb-3">System Prompt</h4>
          <pre className="text-sm text-surface-700 whitespace-pre-wrap bg-surface-50 p-3 rounded-lg">
            {session.systemPrompt}
          </pre>
        </div>
      )}
    </div>
  );
}
