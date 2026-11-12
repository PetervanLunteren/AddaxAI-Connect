/**
 * The one bar across the top of every page behind the login.
 *
 * Right is always the account menu, so "me" is in the same corner on the
 * Projects page, on the server pages and inside a project. Left is up to the
 * page: the logo, and inside a project on a phone the button that opens the
 * navigation.
 *
 * It stays in view while the page scrolls. The top offset is the status bar
 * strip of the installed app (body::before), 0 in a normal browser. z-30 is
 * the "in-page sticky" layer of the ladder in FRONTEND_CONVENTIONS.md, so
 * dialogs, slide-outs and the navigation drawer all cover the bar.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { AccountMenu } from '../AccountMenu';

export const TopBarLogo: React.FC<{ className?: string }> = ({ className = '' }) => (
  <Link to="/projects" className={`shrink-0 ${className}`} aria-label="Projects">
    <img src="/logo-wide.png" alt="AddaxAI Connect" className="h-9 w-auto" />
  </Link>
);

export const TopBar: React.FC<{ left?: React.ReactNode }> = ({ left }) => (
  <header className="sticky top-[env(safe-area-inset-top)] z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-card px-4 sm:px-6">
    <div className="flex min-w-0 items-center gap-3">{left}</div>
    <AccountMenu />
  </header>
);
