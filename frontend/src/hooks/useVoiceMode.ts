import { useState, useCallback, useRef, useEffect } from 'react';
import { api } from '../services/api';
import { isNativePlatform } from '../utils/platform';
import { preprocessForTTS } from '../utils/ttsPreprocess';

export type OrbState = 'hidden' | 'idle' | 'thinking' | 'speaking' | 'done';

export interface VoiceSettings {
  voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
  speed: number;
}

const STORAGE_KEY = 'voice-mode-settings';
const DONE_TIMEOUT_MS = 1500;

function loadSettings(): { enabled: boolean; settings: VoiceSettings } {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return { enabled: false, settings: { voice: 'nova', speed: 1.0 } };
}

function saveSettings(enabled: boolean, settings: VoiceSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled, settings }));
  } catch { /* ignore */ }
}

export function useVoiceMode() {
  const initialSettings = loadSettings();
  const [voiceModeEnabled, setVoiceModeEnabled] = useState(initialSettings.enabled);
  const [voiceSettings, setVoiceSettingsState] = useState<VoiceSettings>(initialSettings.settings);
  const [orbState, setOrbState] = useState<OrbState>('hidden');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceModeEnabledRef = useRef(voiceModeEnabled);
  const orbStateRef = useRef(orbState);
  useEffect(() => { voiceModeEnabledRef.current = voiceModeEnabled; }, [voiceModeEnabled]);
  useEffect(() => { orbStateRef.current = orbState; }, [orbState]);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      const src = audioRef.current.src;
      audioRef.current = null;
      if (src.startsWith('blob:')) URL.revokeObjectURL(src);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAudio();
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
    };
  }, [stopAudio]);

  const transitionToDone = useCallback(() => {
    setOrbState('done');
    doneTimerRef.current = setTimeout(() => {
      setOrbState('hidden');
      doneTimerRef.current = null;
    }, DONE_TIMEOUT_MS);
  }, []);

  const playTTSWithLifecycle = useCallback(async (text: string) => {
    stopAudio(); // Stop any previous playback first
    try {
      const cleanText = preprocessForTTS(text);
      if (!cleanText) {
        transitionToDone();
        return;
      }
      const response = await api.post('/chat/voice/synthesize', {
        text: cleanText.substring(0, 4096),
        voice: voiceSettings.voice,
        speed: Math.min(Math.max(voiceSettings.speed, 0.25), 4.0),
      }, { responseType: 'blob' });

      const contentType = response.headers?.['content-type'] || 'audio/mpeg';
      const audioBlob = new Blob([response.data], { type: contentType });
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        if (audioRef.current === audio) {
          audioRef.current = null;
          transitionToDone();
        }
      };

      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        if (audioRef.current === audio) {
          audioRef.current = null;
          transitionToDone();
        }
      };

      setOrbState('speaking');

      // Haptic feedback on native
      if (isNativePlatform()) {
        import('@capacitor/haptics').then(({ Haptics, ImpactStyle }) => {
          Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
        }).catch(() => {});
      }

      await audio.play();
    } catch (err) {
      console.error('[VoiceMode] TTS playback failed:', err);
      transitionToDone();
    }
  }, [voiceSettings, transitionToDone, stopAudio]);

  const toggleVoiceMode = useCallback(() => {
    setVoiceModeEnabled(prev => {
      const next = !prev;
      saveSettings(next, voiceSettings);
      return next;
    });
  }, [voiceSettings]);

  const setVoiceSettings = useCallback((settings: VoiceSettings) => {
    setVoiceSettingsState(settings);
    saveSettings(voiceModeEnabledRef.current, settings);
  }, []);

  const stopSpeaking = useCallback(() => {
    stopAudio();
    transitionToDone();
  }, [stopAudio, transitionToDone]);

  const dismissOrb = useCallback(() => {
    stopAudio();
    if (doneTimerRef.current) {
      clearTimeout(doneTimerRef.current);
      doneTimerRef.current = null;
    }
    setOrbState('hidden');
  }, [stopAudio]);

  // State machine callbacks - use refs to avoid stale closures
  // (these are called from useEffect in ChatPage where orbState may be stale)
  const onStreamStart = useCallback(() => {
    if (!voiceModeEnabledRef.current) return;
    setOrbState('idle');
  }, []);

  const onThinkingStart = useCallback(() => {
    if (orbStateRef.current === 'hidden') return;
    setOrbState('thinking');
  }, []);

  const onThinkingDone = useCallback(() => {
    if (orbStateRef.current !== 'thinking') return;
    setOrbState('idle');
  }, []);

  const onStreamDone = useCallback((responseText: string) => {
    if (orbStateRef.current === 'hidden') return;
    if (responseText.trim()) {
      playTTSWithLifecycle(responseText);
    } else {
      transitionToDone();
    }
  }, [playTTSWithLifecycle, transitionToDone]);

  const onStreamError = useCallback(() => {
    if (orbStateRef.current === 'hidden') return;
    transitionToDone();
  }, [transitionToDone]);

  return {
    voiceModeEnabled,
    orbState,
    voiceSettings,
    toggleVoiceMode,
    setVoiceSettings,
    stopSpeaking,
    dismissOrb,
    onStreamStart,
    onThinkingStart,
    onThinkingDone,
    onStreamDone,
    onStreamError,
  };
}
