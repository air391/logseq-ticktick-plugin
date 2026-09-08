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
];

export const getTickTickSettings = () => {
  const accessToken = logseq.settings!['access_token'];
  const service = logseq.settings!['service'] as TaskService | undefined;

  return {
    accessToken: accessToken || '',
    service: service || 'dida',
  };
};
