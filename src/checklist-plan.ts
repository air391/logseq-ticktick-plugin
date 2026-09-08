export type ChecklistApplyPlan = 'positional' | 'append' | 'rebuild';

const sameMultiset = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
};

const isPrefix = (prefix: string[], full: string[]): boolean =>
  prefix.length <= full.length && prefix.every((value, index) => value === full[index]);

export const planChecklistApply = (
  localTitles: string[],
  remoteTitles: string[],
): ChecklistApplyPlan => {
  if (remoteTitles.length < localTitles.length) return 'rebuild';

  if (remoteTitles.length > localTitles.length) {
    return isPrefix(localTitles, remoteTitles) ? 'append' : 'rebuild';
  }

  const orderChanged = localTitles.some((value, index) => value !== remoteTitles[index]);
  if (orderChanged && sameMultiset(localTitles, remoteTitles)) return 'rebuild';

  return 'positional';
};
