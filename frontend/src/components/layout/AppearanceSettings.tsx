import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Check, FlaskConical } from 'lucide-react';
import { applyTheme, useUIStore, type ColorTheme, type NumFont, type ThemeMode } from '@/store/uiStore';
import { cn } from '@/lib/utils/cn';

/**
 * Impostazioni di aspetto dentro il menu profilo. Prima erano tre icone nella
 * TopBar (tema, lingua, palette): le linee guida Liquid Glass chiedono pochi
 * controlli flottanti, raggruppati, quindi qui c'è tutto ciò che si cambia di
 * rado e nella barra restano solo le azioni frequenti.
 */
const PALETTES: { key: ColorTheme; labelKey: string; swatch: string }[] = [
  { key: 'registro', labelKey: 'common.theme.registro', swatch: 'hsl(205, 62%, 26%)' },
  { key: 'glass', labelKey: 'common.theme.glass', swatch: 'hsl(250, 84%, 60%)' },
  { key: 'fintech', labelKey: 'common.theme.fintech', swatch: 'hsl(175, 80%, 50%)' },
  { key: 'linear', labelKey: 'common.theme.linear', swatch: 'hsl(221, 83%, 53%)' },
  { key: 'nordic', labelKey: 'common.theme.nordic', swatch: 'hsl(200, 60%, 38%)' },
  { key: 'sunset', labelKey: 'common.theme.sunset', swatch: 'hsl(18, 80%, 55%)' },
];

const FONTS: { key: NumFont; labelKey: string }[] = [
  { key: 'sans', labelKey: 'common.theme.fontSans' },
  { key: 'mono', labelKey: 'common.theme.fontMono' },
  { key: 'serif', labelKey: 'common.theme.fontSerif' },
];

const MODES: { key: ThemeMode; labelKey: string }[] = [
  { key: 'light', labelKey: 'common.theme.light' },
  { key: 'dark', labelKey: 'common.theme.dark' },
  { key: 'system', labelKey: 'common.theme.system' },
];

const LANGS = [
  { key: 'it', label: 'Italiano' },
  { key: 'en', label: 'English' },
] as const;

/** Controllo segmentato: una scelta tra poche opzioni, a colpo d'occhio. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-xl bg-foreground/[0.06] p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            'flex-1 rounded-[10px] px-2 py-1.5 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150',
            value === o.key
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-1 pb-1.5 pt-1 text-xs font-medium text-muted-foreground">{children}</div>;
}

export function AppearanceSettings() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const colorTheme = useUIStore((s) => s.colorTheme);
  const setColorTheme = useUIStore((s) => s.setColorTheme);
  const numFont = useUIStore((s) => s.numFont);
  const setNumFont = useUIStore((s) => s.setNumFont);
  const glassBlur = useUIStore((s) => s.glassBlur);
  const setGlassBlur = useUIStore((s) => s.setGlassBlur);
  const demoData = useUIStore((s) => s.demoData);
  const toggleDemoData = useUIStore((s) => s.toggleDemoData);
  const lang = (i18n.resolvedLanguage ?? 'it') as 'it' | 'en';

  const onToggleDemo = () => {
    toggleDemoData();
    // Entrando/uscendo dalla demo si svuota la cache: ogni pagina rilegge i
    // dati giusti (finti o reali).
    void queryClient.invalidateQueries();
    void queryClient.removeQueries();
  };

  return (
    <div className="space-y-3 px-1.5 pb-1">
      <div>
        <SectionLabel>{t('common.theme.mode')}</SectionLabel>
        <Segmented
          label={t('common.theme.mode')}
          value={theme}
          options={MODES.map((m) => ({ key: m.key, label: t(m.labelKey) }))}
          onChange={(m) => {
            setTheme(m);
            applyTheme(m);
          }}
        />
      </div>

      <div>
        <SectionLabel>{t('common.language')}</SectionLabel>
        <Segmented
          label={t('common.language')}
          value={lang}
          options={LANGS.map((l) => ({ key: l.key, label: l.label }))}
          onChange={(l) => void i18n.changeLanguage(l)}
        />
      </div>

      <div>
        <SectionLabel>{t('common.theme.palette')}</SectionLabel>
        <div role="radiogroup" aria-label={t('common.theme.palette')} className="flex flex-wrap gap-2 px-1">
          {PALETTES.map((p) => (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={colorTheme === p.key}
              aria-label={t(p.labelKey)}
              title={t(p.labelKey)}
              onClick={() => setColorTheme(p.key)}
              className={cn(
                'grid h-8 w-8 place-items-center rounded-full ring-offset-2 ring-offset-popover transition-transform duration-150 active:scale-90',
                colorTheme === p.key ? 'ring-2 ring-foreground/70' : 'ring-1 ring-border',
              )}
              style={{ background: p.swatch }}
            >
              {colorTheme === p.key && <Check className="h-4 w-4 text-white" strokeWidth={3} />}
            </button>
          ))}
        </div>
      </div>

      <div>
        <SectionLabel>{t('common.theme.numFont')}</SectionLabel>
        <Segmented
          label={t('common.theme.numFont')}
          value={numFont}
          options={FONTS.map((f) => ({ key: f.key, label: t(f.labelKey) }))}
          onChange={setNumFont}
        />
      </div>

      <div className="space-y-0.5">
        <button
          type="button"
          role="switch"
          aria-checked={glassBlur}
          onClick={() => setGlassBlur(!glassBlur)}
          className="flex w-full items-center gap-3 rounded-lg px-1 py-1.5 text-left text-sm hover:bg-accent/60"
        >
          <span className="flex-1">
            <span className="block">{t('common.theme.glassBlur')}</span>
            <span className="block text-[11px] text-muted-foreground">{t('common.theme.glassBlurHint')}</span>
          </span>
          <Switch on={glassBlur} />
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={demoData}
          onClick={onToggleDemo}
          className="flex w-full items-center gap-3 rounded-lg px-1 py-1.5 text-left text-sm hover:bg-accent/60"
        >
          <span className="flex-1">
            <span className="flex items-center gap-1.5">
              <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />
              {t('common.demo.label')}
            </span>
            <span className="block text-[11px] text-muted-foreground">
              Mostra dati finti. I dati reali non vengono toccati.
            </span>
          </span>
          <Switch on={demoData} />
        </button>
      </div>
    </div>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-flex h-[22px] w-10 shrink-0 items-center rounded-full transition-colors duration-200',
        on ? 'bg-primary' : 'bg-muted-foreground/30',
      )}
    >
      <span
        className={cn(
          'h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-200 ease-[var(--ease-out)]',
          on ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </span>
  );
}
