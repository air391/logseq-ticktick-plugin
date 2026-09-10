import { BlockEntity } from '@logseq/libs/dist/LSPlugin';

const propertyKeywordForDbGraph = async (key: string): Promise<string | null> => {
  const property = await logseq.Editor.getProperty(key);
  const ident = property?.ident;
  if (!ident || typeof ident !== 'string') return null;
  return ident.startsWith(':') ? ident : `:${ident}`;
};

const currentIsDbGraph = async (): Promise<boolean> => {
  try {
    return await logseq.App.checkCurrentIsDbGraph();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Not existed method #checkCurrentIsDbGraph')) {
      // Older File Graph runtimes expose the JS proxy but do not implement the RPC.
      // Those releases are File Graph-only, so the legacy property query is correct.
      return false;
    }
    throw error;
  }
};

export const readPluginProperty = (
  properties: Record<string, any>,
  key: string,
): string => {
  const exact = properties[key];
  if (typeof exact === 'string') return exact;

  const namespacedKey = Object.keys(properties).find((candidate) =>
    candidate === key
    || candidate.endsWith(`.${key}`)
    || candidate.endsWith(`/${key}`),
  );
  const value = namespacedKey ? properties[namespacedKey] : undefined;
  return typeof value === 'string' ? value : '';
};

export const queryBlocksByPluginProperty = async (
  key: string,
  value?: string,
): Promise<BlockEntity[]> => {
  const isDbGraph = await currentIsDbGraph();

  if (isDbGraph) {
    const propertyKeyword = await propertyKeywordForDbGraph(key);
    if (!propertyKeyword) return [];

    const query = value === undefined
      ? `
        [:find (pull ?b [*])
         :where
         [?b ${propertyKeyword} ?property-value]]
      `
      : `
        [:find (pull ?b [*])
         :in $ ?expected-value
         :where
         [?b ${propertyKeyword} ?property-value]
         [(= ?property-value ?expected-value)]]
      `;

    const rows = value === undefined
      ? await logseq.DB.datascriptQuery(query)
      : await logseq.DB.datascriptQuery(query, value);
    return (rows || [])
      .map((row: any[]) => row?.[0] as BlockEntity | undefined)
      .filter((block: BlockEntity | undefined): block is BlockEntity => Boolean(block));
  }

  const query = value === undefined
    ? `
      [:find (pull ?b [*])
       :where
       [?b :block/properties ?props]
       [(get ?props :${key})]]
    `
    : `
      [:find (pull ?b [*])
       :in $ ?expected-value
       :where
       [?b :block/properties ?props]
       [(get ?props :${key}) ?property-value]
       [(= ?property-value ?expected-value)]]
    `;

  const rows = value === undefined
    ? await logseq.DB.datascriptQuery(query)
    : await logseq.DB.datascriptQuery(query, value);
  return (rows || [])
    .map((row: any[]) => row?.[0] as BlockEntity | undefined)
    .filter((block: BlockEntity | undefined): block is BlockEntity => Boolean(block));
};
