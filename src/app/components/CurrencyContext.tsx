import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export interface CurrencyConfig {
  symbol: string;        // "Br", "$", "€", "₽"
  name: string;          // "BYN", "USD", "EUR", "RUB"
  position: "prefix" | "suffix"; // где ставить символ
}

const CURRENCIES: CurrencyConfig[] = [
  { symbol: "Br",  name: "BYN",  position: "suffix" },
  { symbol: "₽",   name: "RUB",  position: "suffix" },
  { symbol: "$",   name: "USD",  position: "prefix" },
  { symbol: "€",   name: "EUR",  position: "prefix" },
  { symbol: "₴",   name: "UAH",  position: "suffix" },
];

const DEFAULT: CurrencyConfig = CURRENCIES[0];

interface CurrencyContextType {
  currency: CurrencyConfig;
  setCurrency: (c: CurrencyConfig) => void;
  fmt: (n: number, decimals?: number) => string;   // "1 490,00 Br"
  fmtShort: (n: number) => string;                 // "1 490 Br"
  CURRENCIES: CurrencyConfig[];
}

const CurrencyContext = createContext<CurrencyContextType | null>(null);

function loadSaved(): CurrencyConfig {
  try {
    const raw = localStorage.getItem("kapelan_currency");
    if (raw) {
      const parsed = JSON.parse(raw) as CurrencyConfig;
      if (parsed.symbol && parsed.name) return parsed;
    }
  } catch {}
  return DEFAULT;
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<CurrencyConfig>(loadSaved);

  const setCurrency = useCallback((c: CurrencyConfig) => {
    setCurrencyState(c);
    try { localStorage.setItem("kapelan_currency", JSON.stringify(c)); } catch {}
  }, []);

  const fmt = useCallback((n: number, decimals = 2): string => {
    const formatted = n.toLocaleString("ru-RU", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return currency.position === "prefix"
      ? `${currency.symbol}${formatted}`
      : `${formatted} ${currency.symbol}`;
  }, [currency]);

  const fmtShort = useCallback((n: number): string => {
    const formatted = n.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    return currency.position === "prefix"
      ? `${currency.symbol}${formatted}`
      : `${formatted} ${currency.symbol}`;
  }, [currency]);

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, fmt, fmtShort, CURRENCIES }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error("useCurrency must be used within CurrencyProvider");
  return ctx;
}
