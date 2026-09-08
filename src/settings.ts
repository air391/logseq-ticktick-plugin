import { SettingSchemaDesc } from '@logseq/libs/dist/LSPlugin';
import { TaskService } from './ticktick/ticktick';

export const settingsSchema: SettingSchemaDesc[] = [
  {
    key: 'service',
    type: 'enum',
    title: 'Task Service',
    description: 'Choose Dida365 (China) or TickTick (international).',
    default: 'dida',
    enumChoices: ['dida', 'ticktick'],
    enumPicker: 'radio',
  },
  {
    key: 'access_token',
    type: 'string',
    title: 'Access Token',
    description: 'Paste the access token for the selected task service.',
    default: '',
  },
  {
    key: 'auto_refresh_dida_inbox',
    type: 'boolean',
    title: 'Auto Refresh Dida Inbox',
    description: 'Automatically import unlinked open Dida tasks into [[Dida Inbox]] while Logseq is running.',
    default: true,
  },
];

export const getTickTickSettings = () => {
  const accessToken = logseq.settings!['access_token'];
  const service = logseq.settings!['service'] as TaskService | undefined;
  const autoRefreshDidaInbox = logseq.settings!['auto_refresh_dida_inbox'];

  return {
    accessToken: accessToken || '',
    service: service || 'dida',
    autoRefreshDidaInbox: autoRefreshDidaInbox !== false,
  };
};
