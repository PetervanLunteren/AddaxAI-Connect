/**
 * The keyboard hint on a button: "Verify ⏎", "Wrong W".
 *
 * The same part as in AddaxAI desktop (frontend/src/components/ui/kbd.tsx),
 * so both apps mark their shortcuts alike. `onPrimary` is for a key on a
 * filled (primary) button, where the muted border would vanish into the
 * fill. Hidden on touch screens, where there is no keyboard.
 */
import type { ReactNode } from 'react';

export function Kbd({ children, onPrimary }: { children: ReactNode; onPrimary?: boolean }) {
  return (
    <kbd
      className={
        onPrimary
          ? 'hidden sm:inline ml-1.5 text-[10px] font-sans text-primary-foreground/60 border border-primary-foreground/30 rounded px-1 py-0.5 shadow-[0_1px_0_0_rgba(255,255,255,0.1)] leading-none'
          : 'hidden sm:inline ml-1.5 text-[10px] font-sans text-muted-foreground/60 border border-border/60 rounded px-1 py-0.5 shadow-[0_1px_0_0_rgba(0,0,0,0.08)] leading-none'
      }
    >
      {children}
    </kbd>
  );
}
