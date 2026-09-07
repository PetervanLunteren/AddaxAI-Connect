/**
 * The delivery channels a rule can name, and the copy that goes with them.
 * One place, so the three rule sheets and the integration pages agree.
 *
 * A project channel (EarthRanger, Sensing Clues) belongs to the project and
 * is managed on its integration page; the rule sheets open in a locked mode
 * for it and take their header copy from PROJECT_SHEET_COPY.
 */
export type ProjectChannel = 'earthranger' | 'sensingclues';
export type RuleChannel = 'email' | 'telegram' | ProjectChannel;

const CHANNEL_LABELS: Record<RuleChannel, string> = {
  email: 'Email',
  telegram: 'Telegram',
  earthranger: 'EarthRanger',
  sensingclues: 'Sensing Clues',
};

export const channelLabel = (channel: string): string =>
  CHANNEL_LABELS[channel as RuleChannel] ?? channel;

export type SheetKind = 'detection' | 'camera' | 'theft';

interface SheetCopy {
  title: string;
  description: string;
}

/** Sheet header when a rule sheet is opened from an integration page. */
export const PROJECT_SHEET_COPY: Record<ProjectChannel, Record<SheetKind, SheetCopy>> = {
  earthranger: {
    detection: {
      title: 'Detection events for EarthRanger',
      description: 'Each match posts one event with the photo on the ranger map. Rules can be narrowed by site, time of day, or group size, and quieted with a cooldown so one visit gives one event. These rules belong to the project and any admin can change them.',
    },
    camera: {
      title: 'Camera condition events for EarthRanger',
      description: 'Each camera that needs attention posts one event at its site on the ranger map, once per incident. Rules are checked once a day and re-arm when the camera recovers. These rules belong to the project and any admin can change them.',
    },
    theft: {
      title: 'Theft watch events for EarthRanger',
      description: 'A person unusually close to a camera, or a camera silent for longer than its own rhythm, posts one event at the site on the ranger map. A new or moved camera first learns its normal pattern for 14 days. This feature is in beta and can raise false alarms. These rules belong to the project and any admin can change them.',
    },
  },
  sensingclues: {
    detection: {
      title: 'Detection observations for Sensing Clues',
      description: 'Each match posts one observation with the photo in your Cluey group. Rules can be narrowed by site, time of day, or group size, and quieted with a cooldown so one visit gives one observation. These rules belong to the project and any admin can change them.',
    },
    camera: {
      title: 'Camera condition observations for Sensing Clues',
      description: 'Each camera that needs attention posts one observation at its site in your Cluey group, once per incident. Rules are checked once a day and re-arm when the camera recovers. These rules belong to the project and any admin can change them.',
    },
    theft: {
      title: 'Theft watch observations for Sensing Clues',
      description: 'A person unusually close to a camera, or a camera silent for longer than its own rhythm, posts one observation at the site in your Cluey group. A new or moved camera first learns its normal pattern for 14 days. This feature is in beta and can raise false alarms. These rules belong to the project and any admin can change them.',
    },
  },
};
