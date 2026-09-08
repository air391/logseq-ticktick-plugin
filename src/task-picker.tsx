import React, { useEffect, useMemo, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Project, Task } from './ticktick/task';

export interface TaskChoice {
  project: Project;
  task: Task;
  linked?: boolean;
}

let root: Root | null = null;

interface TaskPickerProps {
  choices: TaskChoice[];
  onSelect: (choice: TaskChoice) => Promise<void>;
  onClose: () => void;
}

const TaskPicker = ({ choices, onSelect, onClose }: TaskPickerProps) => {
  const [query, setQuery] = useState('');
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && busyTaskId === null) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busyTaskId, onClose]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return choices;
    return choices.filter(({ project, task }) =>
      `${task.title} ${project.name}`.toLowerCase().includes(normalized),
    );
  }, [choices, query]);

  const select = async (choice: TaskChoice) => {
    if (choice.linked || busyTaskId) return;
    setBusyTaskId(choice.task.id);
    setError(null);
    try {
      await onSelect(choice);
      onClose();
    } catch (selectionError) {
      console.error('Failed to link selected Dida task', selectionError);
      setError(selectionError instanceof Error ? selectionError.message : 'Failed to link the selected task.');
    } finally {
      setBusyTaskId(null);
    }
  };

  return (
    <div className="fixed inset-0 flex items-start justify-center bg-black/30 pt-[12vh]" onClick={() => {
      if (busyTaskId === null) onClose();
    }}>
      <div
        className="w-[min(720px,90vw)] overflow-hidden rounded-xl bg-white text-slate-900 shadow-2xl dark:bg-slate-800 dark:text-slate-100"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-slate-200 p-4 dark:border-slate-700">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div>
              <div className="text-base font-semibold">Link existing Dida task</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Select an existing open task to bind to the current Logseq block.
              </div>
            </div>
            <button
              className="rounded px-2 py-1 text-sm hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-700"
              disabled={busyTaskId !== null}
              onClick={onClose}
            >
              Esc
            </button>
          </div>
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && filtered.length === 1 && !filtered[0].linked) {
                void select(filtered[0]);
              }
            }}
            placeholder="Search title or project..."
            className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 outline-none focus:border-slate-500 dark:border-slate-600"
          />
          {error ? (
            <div role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          ) : null}
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">No matching open tasks.</div>
          ) : (
            filtered.map((choice) => (
              <button
                key={`${choice.project.id}:${choice.task.id}`}
                disabled={choice.linked || busyTaskId !== null}
                onClick={() => void select(choice)}
                className="flex w-full items-start justify-between gap-4 rounded-lg px-3 py-3 text-left hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-slate-700"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{choice.task.title}</div>
                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {choice.project.name}
                    {choice.task.dueDate ? ` · ${choice.task.dueDate}` : ''}
                  </div>
                </div>
                <div className="shrink-0 text-xs text-slate-500">
                  {choice.linked ? 'Already linked' : busyTaskId === choice.task.id ? 'Linking…' : 'Link'}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export const openTaskPicker = (
  choices: TaskChoice[],
  onSelect: (choice: TaskChoice) => Promise<void>,
): void => {
  const container = document.getElementById('app');
  if (!container) throw new Error('Plugin UI root not found');

  if (!root) root = createRoot(container);

  const close = () => {
    logseq.hideMainUI();
  };

  logseq.setMainUIInlineStyle({
    position: 'fixed',
    inset: '0',
    width: '100vw',
    height: '100vh',
    zIndex: 10000,
  });
  root.render(<TaskPicker choices={choices} onSelect={onSelect} onClose={close} />);
  logseq.showMainUI({ autoFocus: true });
};
