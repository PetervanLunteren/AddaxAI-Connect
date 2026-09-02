/**
 * One settings row: a label and description on the left, actions on the right.
 *
 * The single shape every configuration surface uses, the Telegram bot on the
 * server settings page, the Telegram account and alert rules on the
 * notifications page, the connection and rules on an integration page. Keeping
 * it in one place means every row lines up and a change lands everywhere.
 *
 * Put a <SettingRowDivider /> between rows inside the same Card.
 */
import React from 'react';

interface SettingRowProps {
  title: React.ReactNode;
  /** Set when the row's control is a labelled input (checkbox, switch). */
  titleFor?: string;
  /** Left-column body. Inline content only, it renders inside a <p>. */
  description?: React.ReactNode;
  /** Right-column actions: a button, a pill, a switch. */
  children?: React.ReactNode;
  className?: string;
}

export const SettingRow: React.FC<SettingRowProps> = ({
  title, titleFor, description, children, className = '',
}) => (
  <div className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8 ${className}`}>
    <div className="w-full sm:w-1/2 sm:shrink-0">
      <label htmlFor={titleFor} className={`text-sm font-medium block${titleFor ? ' cursor-pointer' : ''}`}>
        {title}
      </label>
      {description != null && (
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      )}
    </div>
    <div className="flex-1">{children}</div>
  </div>
);

export const SettingRowDivider: React.FC = () => <div className="border-t my-6" />;
