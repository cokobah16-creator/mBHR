import { useState, useEffect, useCallback, useRef } from "react";
import { useT } from "@/hooks/useT";
import { getAudioPromptText, getAudioFilePath } from "@/config/audioPrompts";

interface AudioSettings {
  enabled: boolean;
  volume: number;
  autoPlay: boolean;
  preferTTS: boolean;
  rate: number;
}

const DEFAULT_SETTINGS: AudioSettings = {
  enabled: true,
  volume: 0.7,
  autoPlay: false,
  preferTTS: false,
  rate: 0.9,
};

const audioCache = new Map<string, HTMLAudioElement>();

export function useAudioPrompts() {
  const { locale } = useT();
  const [settings, setSettings] = useState<AudioSettings>(DEFAULT_SETTINGS);
  const [isPlaying, setIsPlaying] = useState(false);
  const currentUtterance = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("mbhr-audio-settings");
    if (saved) {
      try {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) });
      } catch (error) {
        console.warn("Failed to load audio settings:", error);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("mbhr-audio-settings", JSON.stringify(settings));
  }, [settings]);

  const stopCurrentAudio = useCallback(() => {
    if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
    }
    currentUtterance.current = null;
  }, []);

  const speakWithTTS = useCallback(
    (text: string, lang: string) => {
      return new Promise<void>((resolve, reject) => {
        if (!("speechSynthesis" in window)) {
          reject(new Error("Speech synthesis not supported"));
          return;
        }

        stopCurrentAudio();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang;
        utterance.volume = settings.volume;
        utterance.rate = settings.rate;

        const voices = speechSynthesis.getVoices();
        const matchingVoice = voices.find((v) =>
          v.lang.startsWith(lang.split("-")[0]),
        );
        if (matchingVoice) {
          utterance.voice = matchingVoice;
        }

        utterance.onend = () => {
          currentUtterance.current = null;
          resolve();
        };
        utterance.onerror = (e) => {
          currentUtterance.current = null;
          reject(e);
        };

        currentUtterance.current = utterance;
        speechSynthesis.speak(utterance);
      });
    },
    [settings.volume, settings.rate, stopCurrentAudio],
  );

  const playAudioFile = useCallback(
    (url: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        let audio = audioCache.get(url);

        if (!audio) {
          audio = new Audio(url);
          audio.preload = "auto";
        }

        audio.volume = settings.volume;

        const handleEnded = () => {
          audio?.removeEventListener("ended", handleEnded);
          audio?.removeEventListener("error", handleError);
          resolve();
        };

        const handleError = () => {
          audio?.removeEventListener("ended", handleEnded);
          audio?.removeEventListener("error", handleError);
          audioCache.delete(url);
          reject(new Error("Audio file not found"));
        };

        audio.addEventListener("ended", handleEnded);
        audio.addEventListener("error", handleError);

        audio.play().catch(handleError);
      });
    },
    [settings.volume],
  );

  const playPrompt = useCallback(
    async (key: string, fallbackText?: string) => {
      if (!settings.enabled || isPlaying) return;

      setIsPlaying(true);

      const promptText = getAudioPromptText(key, locale) || fallbackText || key;
      const langCode = getLanguageCode(locale);

      try {
        if (settings.preferTTS) {
          await speakWithTTS(promptText, langCode);
        } else {
          const audioPath = getAudioFilePath(key, locale);
          try {
            await playAudioFile(audioPath);
          } catch {
            await speakWithTTS(promptText, langCode);
          }
        }
      } catch (error) {
        console.warn("Audio playback failed:", error);
      } finally {
        setTimeout(() => setIsPlaying(false), 500);
      }
    },
    [
      settings.enabled,
      settings.preferTTS,
      isPlaying,
      locale,
      speakWithTTS,
      playAudioFile,
    ],
  );

  const preloadAudio = useCallback(
    (keys: string[]) => {
      keys.forEach((key) => {
        const url = getAudioFilePath(key, locale);
        if (!audioCache.has(url)) {
          const audio = new Audio();
          audio.preload = "auto";
          audio.src = url;
          audioCache.set(url, audio);
        }
      });
    },
    [locale],
  );

  const updateSettings = useCallback((newSettings: Partial<AudioSettings>) => {
    setSettings((prev) => ({ ...prev, ...newSettings }));
  }, []);

  return {
    playPrompt,
    settings,
    updateSettings,
    isPlaying,
    stopCurrentAudio,
    preloadAudio,
  };
}

function getLanguageCode(locale: string): string {
  const codes: Record<string, string> = {
    en: "en-US",
    ha: "ha-NG",
    yo: "yo-NG",
    ig: "ig-NG",
    pcm: "en-NG",
  };
  return codes[locale] || "en-US";
}
