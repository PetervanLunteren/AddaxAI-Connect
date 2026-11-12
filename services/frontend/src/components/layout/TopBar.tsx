/**
 * The one bar across the top of every page behind the login.
 *
 * Right is always the account menu, so "me" is in the same corner on the
 * Projects page, on the server pages and inside a project. Left is up to the
 * page: the logo and the link to the projects, or inside a project on a phone
 * the button that opens the navigation.
 *
 * The bar runs from edge to edge of the window, also where the page under it
 * is a centred column. The avatar then never floats in the middle of a wide
 * screen, and the logo is in the same spot as the logo of the project
 * sidebar.
 *
 * It stays in view while the page scrolls. The top offset is the status bar
 * strip of the installed app (body::before), 0 in a normal browser. z-30 is
 * the "in-page sticky" layer of the ladder in FRONTEND_CONVENTIONS.md, so
 * dialogs, slide-outs and the navigation drawer all cover the bar.
 */
import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { AccountMenu } from '../AccountMenu';

export const TopBarLogo: React.FC = () => (
  <Link to="/projects" className="shrink-0" aria-label="Projects">
    <img src="/logo-wide.png" alt="AddaxAI Connect" className="h-9 w-auto" />
  </Link>
);

/**
 * The left side of the bar on a page outside a project: the logo, and the one
 * place those pages have in common to go to, the projects. It replaces a
 * "Back to projects" link in every page, which suggested a path that is not
 * there: those pages are reached from the account menu, not from a project.
 */
export const TopBarHome: React.FC = () => (
  <>
    <TopBarLogo />
    <NavLink
      to="/projects"
      className={({ isActive }) =>
        cn(
          'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
          isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
        )
      }
    >
      Projects
    </NavLink>
  </>
);

export const TopBar: React.FC<{ left?: React.ReactNode }> = ({ left }) => (
  <header className="sticky top-[env(safe-area-inset-top)] z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-card px-4 sm:px-6">
    <div className="flex min-w-0 items-center gap-3">{left}</div>
    <AccountMenu />
  </header>
);
