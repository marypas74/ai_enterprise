import { create } from 'zustand';

export interface PendingJob {
  jobId: string;
  conversationId: number;
  etaSeconds: number;
  queuedAt: number; // Date.now() quando accodato
  estimatedTokens?: number;
  warningMessage?: string;   // set when worker falls back to external API
  fallbackProvider?: string; // provider used for fallback
}

interface JobStore {
  pendingJobs: PendingJob[];
  addJob: (job: PendingJob) => void;
  removeJob: (jobId: string) => void;
  setJobWarning: (jobId: string, warningMessage: string, fallbackProvider?: string) => void;
  getEtaRemaining: (jobId: string) => number; // secondi rimanenti
}

export const useJobStore = create<JobStore>((set, get) => ({
  pendingJobs: [],

  addJob: (job) =>
    set((state) => ({
      pendingJobs: [...state.pendingJobs.filter((j) => j.jobId !== job.jobId), job],
    })),

  removeJob: (jobId) =>
    set((state) => ({
      pendingJobs: state.pendingJobs.filter((j) => j.jobId !== jobId),
    })),

  setJobWarning: (jobId, warningMessage, fallbackProvider) =>
    set((state) => ({
      pendingJobs: state.pendingJobs.map((j) =>
        j.jobId === jobId ? { ...j, warningMessage, fallbackProvider } : j
      ),
    })),

  getEtaRemaining: (jobId) => {
    const job = get().pendingJobs.find((j) => j.jobId === jobId);
    if (!job) return 0;
    const elapsed = Math.floor((Date.now() - job.queuedAt) / 1000);
    return Math.max(0, job.etaSeconds - elapsed);
  },
}));
