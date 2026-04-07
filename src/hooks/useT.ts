import { useTranslation } from "react-i18next";
import type { SupportedLocale } from "@/i18n/types";
import { getAudioPromptText, getAudioFilePath } from "@/config/audioPrompts";

export function useT() {
  const { t: i18nT, i18n } = useTranslation();

  const t = (key: string, fallback?: string): string => {
    const translation = i18nT(key);
    if (translation && translation !== key) return translation;
    return fallback || key.split(".").pop() || key;
  };

  const speak = async (key: string) => {
    const currentLocale = (i18n.language?.split("-")[0] ||
      "en") as SupportedLocale;

    const promptText = getAudioPromptText(key, currentLocale) || t(key);
    const audioPath = getAudioFilePath(key, currentLocale);

    try {
      const audio = new Audio(audioPath);

      audio.onerror = () => {
        speakWithTTS(promptText, currentLocale);
      };

      await audio.play();
    } catch {
      speakWithTTS(promptText, currentLocale);
    }
  };

  const changeLocale = async (locale: SupportedLocale) => {
    await i18n.changeLanguage(locale);
  };

  const currentLanguage = (i18n.language?.split("-")[0] ||
    "en") as SupportedLocale;

  return {
    t,
    speak,
    changeLocale,
    locale: currentLanguage,
    loading: !i18n.isInitialized,
    error: null,
  };
}

function speakWithTTS(text: string, locale: SupportedLocale): void {
  if (!("speechSynthesis" in window)) return;

  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = getLanguageCode(locale);
  utterance.rate = 0.9;
  utterance.volume = 0.8;

  const voices = speechSynthesis.getVoices();
  const langPrefix = locale === "pcm" ? "en" : locale;
  const matchingVoice = voices.find((v) => v.lang.startsWith(langPrefix));
  if (matchingVoice) {
    utterance.voice = matchingVoice;
  }

  speechSynthesis.speak(utterance);
}

function getLanguageCode(locale: SupportedLocale): string {
  const codes = {
    en: "en-US",
    ha: "ha-NG",
    yo: "yo-NG",
    ig: "ig-NG",
    pcm: "en-NG",
  };
  return codes[locale] || "en-US";
}
