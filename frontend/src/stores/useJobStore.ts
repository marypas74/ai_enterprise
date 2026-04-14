import { create } from 'zustand';

export interface PendingJob {
  jobId: string;
  conversationId: number;
  etaSeconds: number;
  queuedAt: number; // Date.now() quando accodato
  estimatedTokens?: number;
}

interface JobStore {
  pendingJobs: PendingJob[];
  addJob: (job: PendingJob) => void;
  removeJob: (jobId: string) => void;
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

  getEtaRemaining: (jobId) => {
    const job = get().pendingJobs.find((j) => j.jobId === jobId);
    if (!job) return 0;
    const elapsed = Math.floor((Date.now() - job.queuedAt) / 1000);
    return Math.max(0, job.etaSeconds - elapsed);
  },
}));
