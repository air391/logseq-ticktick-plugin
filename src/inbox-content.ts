export const DIDA_INBOX_MANAGED_PROPERTIES = [
  'dida-inbox-task-id',
  'dida-inbox-project-id',
  'dida-inbox-project-name',
  'dida-inbox-task-url',
  'dida-inbox-managed-content',
] as const;

export const projectionVisibleContent = (content: string): string => {
  const propertyPrefixes = DIDA_INBOX_MANAGED_PROPERTIES.map((property) => `${property}::`);
  return content
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trimStart();
      return !propertyPrefixes.some((prefix) => trimmed.startsWith(prefix));
    })
    .join('\n')
    .trim();
};
