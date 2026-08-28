/**
 * Display names for the delivery channels a rule can name. One place, so
 * the three rule sheets and the integration page agree.
 */
export type RuleChannel = 'email' | 'telegram' | 'earthranger';

const CHANNEL_LABELS: Record<RuleChannel, string> = {
  email: 'Email',
  telegram: 'Telegram',
  earthranger: 'EarthRanger',
};

export const channelLabel = (channel: string): string =>
  CHANNEL_LABELS[channel as RuleChannel] ?? channel;
