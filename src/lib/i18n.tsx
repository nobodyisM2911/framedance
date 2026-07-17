import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import en from "@/locales/en.json";
import zh from "@/locales/zh-CN.json";

export type Lang = "en" | "zh-CN";

const DICTS: Record<Lang, Record<string, string>> = {
  en: en as Record<string, string>,
  "zh-CN": zh as Record<string, string>,
};

const STORAGE_KEY = "stillframe.lang";

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<Ctx | null>(null);

function interpolate(str: string, vars?: Record<string, string | number>) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) =>
    vars[k] !== undefined ? String(vars[k]) : `{${k}}`,
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // Default to English on SSR + first client render to avoid hydration mismatch.
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY) as Lang | null;
      if (saved === "en" || saved === "zh-CN") setLangState(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const dict = DICTS[lang] ?? DICTS.en;
      const raw = dict[key] ?? DICTS.en[key] ?? key;
      return interpolate(raw, vars);
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { lang, setLang } = useI18n();
  const base =
    "text-[0.7rem] uppercase tracking-[0.28em] transition";
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <button
        type="button"
        onClick={() => setLang("en")}
        className={`${base} ${lang === "en" ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        aria-pressed={lang === "en"}
      >
        EN
      </button>
      <span className="text-[0.7rem] text-muted-foreground/50">·</span>
      <button
        type="button"
        onClick={() => setLang("zh-CN")}
        className={`${base} ${lang === "zh-CN" ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        aria-pressed={lang === "zh-CN"}
      >
        中文
      </button>
    </div>
  );
}
