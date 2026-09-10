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
    key: 'auto_sync_dida',
    type: 'boolean',
    title: 'Auto Sync Dida',
    description: 'Automatically reconcile linked tasks and import unlinked open tasks into [[Dida Inbox]] while Logseq is running.',
    default: true,
  },
];

export const getTickTickSettings = () => {
  const accessToken = logseq.settings!['access_token'];
  const service = logseq.settings!['service'] as TaskService | undefined;
  const autoSyncDida = logseq.settings!['auto_sync_dida'];
  const legacyAutoRefresh = logseq.settings!['auto_refresh_dida_inbox'];

  return {
    accessToken: accessToken || '',
    service: service || 'dida',
    autoSyncDida: autoSyncDida !== undefined ? autoSyncDida !== false : legacyAutoRefresh !== false,
  };
};
