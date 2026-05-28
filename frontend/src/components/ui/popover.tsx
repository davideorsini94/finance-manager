import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '@/lib/utils/cn';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

type PopoverContentProps = React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & {
  /**
   * Renderizza il contenuto inline (senza Portal verso body). Necessario
   * quando il Popover vive dentro un Radix Dialog: `react-remove-scroll`
   * del Dialog blocca wheel/touch sugli elementi fuori dal proprio sottoalbero,
   * impedendo lo scroll di liste interne al popover portato altrove.
   */
  disablePortal?: boolean;
};

export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  PopoverContentProps
>(({ className, align = 'center', sideOffset = 4, disablePortal, ...props }, ref) => {
  const content = (
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        className,
      )}
      {...props}
    />
  );
  if (disablePortal) return content;
  return <PopoverPrimitive.Portal>{content}</PopoverPrimitive.Portal>;
});
PopoverContent.displayName = PopoverPrimitive.Content.displayName;
