// Channel allow-list shared by preload and main (kept free of dependencies so the preload stays tiny).
export const CHANNELS = [
  'app:info', 'app:networkLog',
  'project:create', 'project:open', 'project:openRecent', 'project:forgetRecent', 'project:recent', 'project:current', 'project:close', 'project:openDemo',
  'import:pickFile', 'import:preview', 'import:validate', 'import:commit', 'import:discard',
  'data:versions', 'data:snapshot', 'data:formatGroups', 'data:importReport',
  'curation:editMeta', 'curation:setQuasi', 'curation:setCovariate', 'curation:decideFormat', 'curation:setExclusion', 'curation:nameSegment',
  'curation:setStudyContext', 'curation:getStudyContext', 'curation:history',
  'views:list', 'views:save', 'views:get', 'views:delete',
  'export:preview', 'export:write', 'export:chart', 'export:list',
  'backup:create', 'backup:restore',
  'settings:setAuthor',
  'boards:list', 'boards:get', 'boards:save', 'boards:delete'
] as const
export type ChannelName = (typeof CHANNELS)[number]
