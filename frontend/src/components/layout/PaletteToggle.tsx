import { useState } from 'react';
import { Palette, Check, FlaskConical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { useUIStore, type ColorTheme, type NumFont } from '@/store/uiStore';
import { cn } from '@/lib/utils/cn';

const PALETTES: { key: ColorTheme; labelKey: string; swatch: string }[] = [
  { key: 'registro', labelKey: 'common.theme.registro', swatch: 'hsl(205, 62%, 26%)' },
  { key: 'glass', labelKey: 'common.theme.glass', swatch: 'hsl(250, 84%, 60%)' },
  { key: 'fintech', labelKey: 'common.theme.fintech', swatch: 'hsl(175, 80%, 50%)' },
  { key: 'linear', labelKey: 'common.theme.linear', swatch: 'hsl(221, 83%, 53%)' },
  { key: 'nordic', labelKey: 'common.theme.nordic', swatch: 'hsl(200, 60%, 38%)' },
  { key: 'sunset', labelKey: 'common.theme.sunset', swatch: 'hsl(18, 80%, 55%)' },
];

const FONTS: { key: NumFont; labelKey: string; preview: string }[] = [
  { key: 'sans', labelKey: 'common.theme.fontSans', preview: 'Inter, sans-serif' },
  { key: 'mono', labelKey: 'common.theme.fontMono', preview: "'JetBrains Mono', monospace" },
  { key: 'serif', labelKey: 'common.theme.fontSerif', preview: "'Fraunces', Georgia, serif" },
];

const itemCls =
  'flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground';

export function PaletteToggle() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const colorTheme = useUIStore((s) => s.colorTheme);
  const setColorTheme = useUIStore((s) => s.setColorTheme);
  const numFont = useUIStore((s) => s.numFont);
  const setNumFont = useUIStore((s) => s.setNumFont);
  const demoData = useUIStore((s) => s.demoData);
  const toggleDemoData = useUIStore((s) => s.toggleDemoData);
  const [open, setOpen] = useState(false);

  const onToggleDemo = () => {
    toggleDemoData();
    // Quando si entra/esce dalla modalità demo svuotiamo la cache di react-query
    // così tutte le pagine vengono rifettate (con dati finti o reali a seconda).
    void queryClient.invalidateQueries();
    void queryClient.removeQueries();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('common.theme.palette')}
          className={cn(demoData && 'text-amber-600 dark:text-amber-400')}
        >
          <Palette className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="z-50 w-60 p-1.5">
        <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
          {t('common.theme.palette')}
        </div>
        {PALETTES.map((p) => (
          <button key={p.key} type="button" className={itemCls} onClick={() => setColorTheme(p.key)}>
            <span
              className="h-3.5 w-3.5 rounded-full ring-1 ring-border"
              style={{ background: p.swatch }}
            />
            <span className="flex-1 text-left">{t(p.labelKey)}</span>
            {colorTheme === p.key && <Check className="h-3.5 w-3.5" />}
          </button>
        ))}

        <div className="my-1.5 h-px bg-border" />

        <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
          {t('common.theme.numFont')}
        </div>
        {FONTS.map((f) => (
          <button key={f.key} type="button" className={itemCls} onClick={() => setNumFont(f.key)}>
            <span
              className="w-7 text-center text-sm"
              style={{ fontFamily: f.preview, fontVariantNumeric: 'tabular-nums' }}
            >
              123
            </span>
            <span className="flex-1 text-left">{t(f.labelKey)}</span>
            {numFont === f.key && <Check className="h-3.5 w-3.5" />}
          </button>
        ))}

        <div className="my-1.5 h-px bg-border" />

        <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
          {t('common.demo.label')}
        </div>
        <button type="button" className={itemCls} onClick={onToggleDemo}>
          <FlaskConical
            className={cn(
              'h-3.5 w-3.5',
              demoData ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
            )}
          />
          <span className="flex-1 text-left">
            <span className="block">{demoData ? 'Disattiva' : 'Attiva'} dati demo</span>
            <span className="block text-[11px] font-normal text-muted-foreground">
              Mostra dati fake. I dati reali non vengono toccati.
            </span>
          </span>
          {demoData && <Check className="h-3.5 w-3.5" />}
        </button>

        <div className="my-1.5 h-px bg-border" />
        <button
          type="button"
          className={cn(itemCls, 'justify-center text-muted-foreground')}
          onClick={() => {
            setColorTheme('glass');
            setNumFont('sans');
          }}
        >
          Reset
        </button>
      </PopoverContent>
    </Popover>
  );
}
