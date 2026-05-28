import * as React from 'react';
import { Eye, EyeOff, ClipboardPaste } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, type InputProps } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';

interface Props extends Omit<InputProps, 'type'> {
  /**
   * Quando l'utente incolla, rimuove automaticamente gli spazi.
   * Utile per app password Gmail formattate `abcd efgh ijkl mnop`.
   * Default true.
   */
  stripWhitespaceOnPaste?: boolean;
  /**
   * Mostra il bottone "Incolla dagli appunti". Default true.
   * Richiede contesto sicuro (HTTPS o localhost) per Clipboard API.
   */
  enablePasteButton?: boolean;
  /**
   * Callback opzionale per ricevere il valore dopo "incolla dagli appunti".
   * Se passato, viene chiamato in alternativa a setting native.
   */
  onPasteValue?: (value: string) => void;
}

/**
 * Input password con toggle mostra/nascondi e bottone Incolla integrati.
 * Cerca di funzionare bene con react-hook-form (`{...register("foo")}`)
 * inoltrando il ref tramite forwardRef.
 */
export const PasswordInput = React.forwardRef<HTMLInputElement, Props>(
  (
    { className, stripWhitespaceOnPaste = true, enablePasteButton = true, onPasteValue, ...rest },
    ref,
  ) => {
    const [show, setShow] = React.useState(false);
    const innerRef = React.useRef<HTMLInputElement | null>(null);

    const setRefs = (el: HTMLInputElement | null) => {
      innerRef.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el;
    };

    const setValueAndNotify = (value: string) => {
      if (onPasteValue) {
        onPasteValue(value);
        return;
      }
      const el = innerRef.current;
      if (!el) return;
      // Trick standard per fare in modo che React si accorga del cambiamento
      // quando manipoli .value direttamente (es. su input controllati con register).
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
        ?.set;
      setter?.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const handlePaste: React.ClipboardEventHandler<HTMLInputElement> = (e) => {
      if (!stripWhitespaceOnPaste) return;
      const text = e.clipboardData.getData('text');
      if (!/\s/.test(text)) return;
      e.preventDefault();
      const cleaned = text.replace(/\s+/g, '');
      const target = e.currentTarget;
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? target.value.length;
      const next = target.value.slice(0, start) + cleaned + target.value.slice(end);
      setValueAndNotify(next);
    };

    const onPasteButton = async () => {
      try {
        const text = await navigator.clipboard.readText();
        const cleaned = stripWhitespaceOnPaste ? text.replace(/\s+/g, '') : text;
        setValueAndNotify(cleaned);
        innerRef.current?.focus();
      } catch {
        // Clipboard API negata: cade comunque sul paste manuale
        innerRef.current?.focus();
      }
    };

    return (
      <div className="relative">
        <Input
          ref={setRefs}
          type={show ? 'text' : 'password'}
          autoComplete="off"
          spellCheck={false}
          onPaste={handlePaste}
          className={cn(enablePasteButton ? 'pr-20' : 'pr-10', 'font-mono', className)}
          {...rest}
        />
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {enablePasteButton && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={onPasteButton}
              aria-label="Incolla dagli appunti"
              title="Incolla"
            >
              <ClipboardPaste className="h-4 w-4" />
            </Button>
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? 'Nascondi password' : 'Mostra password'}
            title={show ? 'Nascondi' : 'Mostra'}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';
