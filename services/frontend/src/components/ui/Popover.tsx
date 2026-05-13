/**
 * Popover primitive built on @radix-ui/react-popover.
 *
 * Ported verbatim from AddaxAI WebUI's `components/ui/popover.tsx` so the
 * two products share styling and behaviour. Used by the DateRangePicker
 * and any future popover-based UI.
 */
import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';

import { cn } from '../../lib/utils';

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        // Connect doesn't have tailwindcss-animate, so the WebUI animation
        // classes are dropped — popover appears without a slide/fade.
        // `bg-card text-card-foreground` instead of the WebUI `bg-popover`
        // tokens (Connect's theme has no separate popover palette).
        // z-[1100] keeps the popover above Leaflet's internal panes (the
        // tile / overlay / marker / popup panes use z-indices 200-700);
        // Radix renders this content via a portal at document.body so a
        // parent's z-index alone cannot lift it.
        'z-[1100] w-72 rounded-md border bg-card p-4 text-card-foreground shadow-md outline-none',
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
