// Language selector with audio preview
import React, { useId, useRef, useState } from "react";
import { useT } from "@/hooks/useT";
import { getAvailableLocales } from "@/i18n/load";
import type { SupportedLocale } from "@/i18n/types";
import {
  LanguageIcon,
  SpeakerWaveIcon,
  CheckIcon,
  ChevronDownIcon,
} from "@heroicons/react/24/outline";
import { usePopover } from "@/components/shell/usePopover";

interface LanguageSelectorProps {
  className?: string;
  showAudioPreview?: boolean;
}

export function LanguageSelector({
  className = "",
  showAudioPreview = true,
}: LanguageSelectorProps) {
  const { t, speak, changeLocale, locale, loading } = useT();
  const { open: isOpen, setOpen: setIsOpen, ref } = usePopover();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  const menuId = useId();
  const labelId = `${menuId}-label`;

  const availableLocales = getAvailableLocales();
  const currentLocale = availableLocales.find((l) => l.code === locale);

  const handleLocaleChange = (newLocale: SupportedLocale) => {
    changeLocale(newLocale);
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const playAudioPreview = async (localeCode: SupportedLocale) => {
    setPlayingAudio(localeCode);
    try {
      // Play a sample phrase in the selected language
      await speak("auth.welcome");
    } catch (error) {
      console.warn(
        "Audio preview failed:",
        error instanceof Error ? error.name : error,
      );
    } finally {
      setPlayingAudio(null);
    }
  };

  // usePopover closes on Escape; send focus back to the button that opened it.
  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") triggerRef.current?.focus();
  };

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex min-h-touch-target items-center gap-2 rounded-md border border-line-strong bg-surface px-3 text-label text-ink transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        disabled={loading}
        aria-expanded={isOpen}
        aria-controls={menuId}
      >
        <LanguageIcon className="h-5 w-5 text-ink-muted" aria-hidden />
        <span className="sr-only">{t("language.select")}: </span>
        <span>{currentLocale?.nativeName || "English"}</span>
        <ChevronDownIcon
          className={`h-4 w-4 text-ink-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {isOpen && (
        <div
          id={menuId}
          onKeyDown={onMenuKeyDown}
          className="absolute top-full right-0 z-50 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface shadow-xl"
        >
          <div className="p-2">
            <p id={labelId} className="section-label px-2 py-2">
              {t("language.select")}
            </p>

            <ul aria-labelledby={labelId} className="space-y-0.5">
              {availableLocales.map((localeOption) => {
                const selected = locale === localeOption.code;
                return (
                  <li
                    key={localeOption.code}
                    className="flex items-center gap-1"
                  >
                    <button
                      type="button"
                      onClick={() => handleLocaleChange(localeOption.code)}
                      aria-pressed={selected}
                      className={`flex min-h-touch-target min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 text-left transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                        selected ? "bg-primary-soft" : ""
                      }`}
                    >
                      <span className="min-w-0">
                        <span
                          lang={localeOption.code}
                          className="text-body font-medium text-ink"
                        >
                          {localeOption.nativeName}
                        </span>
                        {localeOption.code !== "en" && (
                          <span className="ml-1.5 text-caption text-ink-muted">
                            ({localeOption.name})
                          </span>
                        )}
                      </span>
                      {selected && (
                        <CheckIcon
                          className="h-4 w-4 shrink-0 text-primary-fg"
                          aria-hidden
                        />
                      )}
                    </button>

                    {showAudioPreview && (
                      <button
                        type="button"
                        onClick={() => {
                          playAudioPreview(localeOption.code);
                        }}
                        className="btn-ghost min-w-touch-target shrink-0 px-2 disabled:opacity-50"
                        disabled={playingAudio === localeOption.code}
                        aria-label={`Play a sample in ${localeOption.name}`}
                      >
                        <SpeakerWaveIcon className="h-4 w-4" aria-hidden />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="border-t border-line p-3">
            <p className="text-caption text-ink-muted">
              {t("language.audioSupport")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
