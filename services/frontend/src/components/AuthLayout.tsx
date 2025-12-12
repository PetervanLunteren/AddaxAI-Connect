/**
 * Shared layout component for authentication pages
 *
 * Provides full-screen background image with overlay
 */
import React from 'react';

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({ title, subtitle, children }) => {
  return (
    <div
      className="min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8 bg-cover bg-center bg-no-repeat relative"
      style={{
        backgroundImage: "url('/auth-background.webp'), url('/auth-background.jpg')",
      }}
    >
      {/* Dark overlay for better text readability */}
      <div className="absolute inset-0 bg-black bg-opacity-40"></div>

      {/* Content */}
      <div className="relative z-10 sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-3xl font-bold text-white drop-shadow-lg">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-2 text-center text-sm text-gray-100 drop-shadow">
            {subtitle}
          </p>
        )}
      </div>

      <div className="relative z-10 mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white bg-opacity-95 backdrop-blur-sm py-8 px-4 shadow-2xl sm:rounded-lg sm:px-10">
          {children}
        </div>
      </div>
    </div>
  );
};
