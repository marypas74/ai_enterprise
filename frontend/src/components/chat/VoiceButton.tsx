/**
 * VoiceButton — Microphone button for voice input (STT) and audio playback (TTS).
 *
 * Uses MediaRecorder API (web) for audio capture, then sends to backend
 * /api/chat/voice/transcribe for Whisper transcription.
 * Optionally calls /api/chat/voice/synthesize for TTS playback of AI responses.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, MicOff, Loader2 } from 'lucide-react';
import { api } from '../../services/api';

interface VoiceButtonProps {
  onTranscription: (text: string) => void;
  disabled?: boolean;
}

export default function VoiceButton({ onTranscription, disabled }: VoiceButtonProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [permissionError, setPermissionError] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const isMountedRef = useRef(true);

  // Cleanup on unmount — stop recording and release mic
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (mediaRecorderRef.current?.state !== 'inactive') {
        mediaRecorderRef.current?.stop();
      }
    };
  }, []);

  const startRecording = useCallback(async () => {
    setPermissionError(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });

      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });

        if (audioBlob.size < 1000) return; // Too small, ignore

        if (isMountedRef.current) setIsTranscribing(true);
        try {
          const formData = new FormData();
          formData.append('file', audioBlob, 'voice.webm');

          const response = await api.post('/chat/voice/transcribe', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 30000,
          });

          if (response.data?.text && isMountedRef.current) {
            onTranscription(response.data.text);
          }
        } catch (err) {
          console.error('[Voice] Transcription failed:', err);
        } finally {
          if (isMountedRef.current) setIsTranscribing(false);
        }
      };

      mediaRecorder.start(250); // Collect in 250ms chunks
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
    } catch (err) {
      console.error('[Voice] Microphone access denied:', err);
      setPermissionError(true);
    }
  }, [onTranscription]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    setIsRecording(false);
  }, []);

  const handleClick = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  if (isTranscribing) {
    return (
      <button
        disabled
        className="p-2 rounded-lg text-amber-500 animate-pulse"
        title="Sto trascrivendo..."
      >
        <Loader2 className="w-5 h-5 animate-spin" />
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className={`p-2 rounded-lg transition-colors ${
        isRecording
          ? 'text-red-500 bg-red-100 dark:bg-red-900/30 animate-pulse'
          : permissionError
            ? 'text-orange-500'
            : 'text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800'
      } disabled:opacity-50`}
      title={
        permissionError
          ? 'Permesso microfono negato. Controlla le impostazioni del browser.'
          : isRecording
            ? 'Clicca per fermare la registrazione'
            : 'Clicca per parlare'
      }
    >
      {isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
    </button>
  );
}

/**
 * Synthesize text to speech and play it.
 * Call this after receiving an AI response to auto-play the voice.
 */
export async function playTTS(text: string, voice = 'nova', speed = 1.0): Promise<void> {
  const response = await api.post('/chat/voice/synthesize', {
    text: text.substring(0, 4096), // API limit
    voice,
    speed,
  }, { responseType: 'blob' });

  const audioBlob = new Blob([response.data], { type: 'audio/mpeg' });
  const audioUrl = URL.createObjectURL(audioBlob);
  const audio = new Audio(audioUrl);
  const cleanup = () => URL.revokeObjectURL(audioUrl);
  audio.onended = cleanup;
  audio.onerror = cleanup;
  await audio.play();
}
