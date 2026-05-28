import { useState } from 'react';
import { Check, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils/cn';

/**
 * Palette estesa: 64 colori organizzati per tinta (chiaro → scuro su ogni
 * riga). I neutri stanno in fondo. Il color input HTML resta disponibile
 * per pickare qualunque colore custom.
 */
const PRESETS = [
  // Reds
  '#fecaca', '#f87171', '#ef4444', '#b91c1c', '#7f1d1d',
  // Oranges
  '#fed7aa', '#fb923c', '#f97316', '#c2410c', '#7c2d12',
  // Amber / Yellow
  '#fde68a', '#fbbf24', '#f59e0b', '#b45309',
  '#fef08a', '#facc15', '#eab308', '#854d0e',
  // Lime / Green
  '#bef264', '#84cc16', '#4d7c0f',
  '#bbf7d0', '#4ade80', '#22c55e', '#15803d',
  // Emerald / Teal
  '#a7f3d0', '#34d399', '#10b981', '#047857',
  '#99f6e4', '#2dd4bf', '#14b8a6', '#0f766e',
  // Cyan / Sky / Blue
  '#a5f3fc', '#22d3ee', '#06b6d4', '#0e7490',
  '#bae6fd', '#38bdf8', '#0ea5e9', '#0369a1',
  '#bfdbfe', '#60a5fa', '#3b82f6', '#1d4ed8', '#1e3a8a',
  // Indigo / Violet / Purple
  '#c7d2fe', '#818cf8', '#6366f1', '#3730a3',
  '#ddd6fe', '#a78bfa', '#8b5cf6', '#5b21b6',
  '#e9d5ff', '#c084fc', '#a855f7', '#6b21a8',
  // Pink / Rose
  '#fbcfe8', '#f472b6', '#ec4899', '#9d174d',
  '#fecdd3', '#fb7185', '#f43f5e', '#9f1239',
  // Neutri
  '#94a3b8', '#64748b', '#334155', '#0f172a',
  '#a8a29e', '#78716c', '#44403c', '#1c1917',
];

interface Props {
  value: string | null | undefined;
  onChange: (color: string | null) => void;
  label?: string;
}

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export function ColorPicker({ value, onChange, label }: Props) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(value && !PRESETS.includes(value) ? value : '');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start gap-2 font-normal"
        >
          <span
            className="h-5 w-5 rounded-md border shrink-0"
            style={{ backgroundColor: value ?? 'transparent' }}
          />
          <span className="truncate text-sm">
            {value ?? <span className="text-muted-foreground">{label ?? 'Scegli colore'}</span>}
          </span>
          <Palette className="ml-auto h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] p-3" align="start">
        <div className="grid max-h-72 grid-cols-9 gap-1.5 overflow-y-auto pr-1">
          {PRESETS.map((color) => {
            const selected = value?.toLowerCase() === color.toLowerCase();
            return (
              <button
                key={color}
                type="button"
                aria-label={color}
                title={color}
                onClick={() => {
                  onChange(color);
                  setOpen(false);
                }}
                className={cn(
                  'relative h-6 w-6 rounded-md border transition-transform hover:scale-110',
                  selected && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
                )}
                style={{ backgroundColor: color }}
              >
                {selected && (
                  <Check
                    className="absolute inset-0 m-auto h-3.5 w-3.5 text-white drop-shadow"
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex items-center gap-2 border-t pt-3">
          <input
            type="color"
            value={custom || value || '#3b82f6'}
            onChange={(e) => {
              setCustom(e.target.value);
              onChange(e.target.value);
            }}
            className="h-9 w-9 rounded-md border bg-transparent p-0.5 cursor-pointer"
            aria-label="Color picker"
          />
          <Input
            value={custom}
            onChange={(e) => {
              const v = e.target.value;
              setCustom(v);
              if (HEX_RE.test(v)) onChange(v);
            }}
            placeholder="#3b82f6"
            className="font-mono text-xs"
          />
          {value && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setCustom('');
                onChange(null);
              }}
            >
              Reset
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
