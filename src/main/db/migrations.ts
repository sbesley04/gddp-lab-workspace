// Ordered schema migrations. Never edit a shipped migration; append a new one.
export const MIGRATIONS: string[] = [
  /* 1: initial schema */ `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE source_file (
  id INTEGER PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('xlsx','csv')),
  stored_name TEXT NOT NULL,
  added_at TEXT NOT NULL
);

CREATE TABLE id_mapping (
  id INTEGER PRIMARY KEY,
  sheet_name TEXT NOT NULL,
  participant_header TEXT NOT NULL,
  event_header TEXT,
  header_row INTEGER NOT NULL,
  header_signature TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  author_label TEXT
);

CREATE TABLE dataset_version (
  id TEXT PRIMARY KEY,
  version_number INTEGER NOT NULL UNIQUE,
  source_file_id INTEGER NOT NULL REFERENCES source_file(id),
  sheet_name TEXT NOT NULL,
  mapping_id INTEGER REFERENCES id_mapping(id),
  mapping_json TEXT NOT NULL,
  import_report_json TEXT NOT NULL,
  legend_json TEXT,
  segments_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  app_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  author_label TEXT
);

CREATE TABLE visit (
  id TEXT PRIMARY KEY,
  dataset_version_id TEXT NOT NULL REFERENCES dataset_version(id),
  event_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  actual_date TEXT -- never inferred; reserved for source-evidenced dates
);

CREATE TABLE participant (
  id INTEGER PRIMARY KEY,
  dataset_version_id TEXT NOT NULL REFERENCES dataset_version(id),
  source_identifier TEXT NOT NULL,
  UNIQUE (dataset_version_id, source_identifier)
);

CREATE TABLE source_row (
  dataset_version_id TEXT NOT NULL REFERENCES dataset_version(id),
  row_index INTEGER NOT NULL,
  row_number INTEGER NOT NULL,
  participant_id INTEGER NOT NULL REFERENCES participant(id),
  visit_id TEXT NOT NULL REFERENCES visit(id),
  PRIMARY KEY (dataset_version_id, row_index)
);

CREATE TABLE variable (
  dataset_version_id TEXT NOT NULL REFERENCES dataset_version(id),
  var_index INTEGER NOT NULL,
  column_index INTEGER NOT NULL,
  column_letter TEXT NOT NULL,
  var_key TEXT NOT NULL,
  header TEXT NOT NULL,
  header_runs_json TEXT,
  role TEXT NOT NULL,
  kind TEXT NOT NULL,
  segment INTEGER,
  subsegment INTEGER,
  aliases_json TEXT NOT NULL,
  attribution_json TEXT,
  header_format_json TEXT NOT NULL,
  quasi_identifier INTEGER NOT NULL,
  categories_json TEXT NOT NULL,
  counts_json TEXT NOT NULL,
  PRIMARY KEY (dataset_version_id, var_index),
  UNIQUE (dataset_version_id, var_key)
);

-- The original wide representation: one row per source cell in the data range.
CREATE TABLE cell (
  dataset_version_id TEXT NOT NULL,
  var_index INTEGER NOT NULL,
  row_index INTEGER NOT NULL,
  value_kind TEXT NOT NULL CHECK (value_kind IN ('missing','number','censored','text')),
  raw_text TEXT,
  numeric_value REAL,
  censor_op TEXT,
  source_type TEXT NOT NULL,
  formula TEXT,
  num_fmt TEXT,
  font_key TEXT,
  fill_key TEXT,
  PRIMARY KEY (dataset_version_id, var_index, row_index)
) WITHOUT ROWID;

-- Reserved for later releases (specimen, batch, replicate, detection limit, units, exposure). Intentionally empty.
CREATE TABLE observation_context (
  dataset_version_id TEXT NOT NULL,
  var_index INTEGER NOT NULL,
  row_index INTEGER NOT NULL,
  specimen TEXT,
  assay_batch TEXT,
  technical_replicate INTEGER,
  detection_limit REAL,
  unit_mapping TEXT,
  treatment_exposure TEXT,
  PRIMARY KEY (dataset_version_id, var_index, row_index)
);

-- Long-form layer over the preserved wide cells.
CREATE VIEW observation AS
  SELECT c.dataset_version_id, p.source_identifier AS participant, vi.event_name AS visit, v.var_key, v.header,
         c.value_kind, c.raw_text, c.numeric_value, c.censor_op, v.column_letter || sr.row_number AS address
  FROM cell c
  JOIN variable v ON v.dataset_version_id = c.dataset_version_id AND v.var_index = c.var_index AND v.role = 'measure'
  JOIN source_row sr ON sr.dataset_version_id = c.dataset_version_id AND sr.row_index = c.row_index
  JOIN participant p ON p.id = sr.participant_id
  JOIN visit vi ON vi.id = sr.visit_id;

CREATE TABLE format_interpretation (
  id INTEGER PRIMARY KEY,
  dataset_version_id TEXT NOT NULL REFERENCES dataset_version(id),
  row_index INTEGER NOT NULL,
  var_index INTEGER NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  category TEXT,
  format_key TEXT NOT NULL,
  detail TEXT NOT NULL
);
CREATE INDEX fi_version ON format_interpretation(dataset_version_id, format_key);

CREATE TABLE annotation (
  id INTEGER PRIMARY KEY,
  dataset_version_id TEXT NOT NULL REFERENCES dataset_version(id),
  address TEXT NOT NULL,
  row_index INTEGER,
  var_index INTEGER,
  text TEXT NOT NULL,
  author TEXT,
  threaded INTEGER NOT NULL,
  created_at TEXT
);

-- Append-only record of curation: metadata edits, formatting decisions, exclusions, study context.
CREATE TABLE revision (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_version_id TEXT NOT NULL REFERENCES dataset_version(id),
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  field TEXT,
  value_json TEXT,
  status TEXT,
  author_label TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX revision_target ON revision(dataset_version_id, kind, target);

CREATE TABLE saved_view (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  dataset_version_id TEXT NOT NULL REFERENCES dataset_version(id),
  metadata_version INTEGER NOT NULL,
  spec_json TEXT NOT NULL,
  app_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  author_label TEXT
);

CREATE TABLE export_record (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  dataset_version_id TEXT,
  metadata_version INTEGER,
  file_name TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  action TEXT NOT NULL,
  detail_json TEXT,
  author_label TEXT
);

-- Immutability: imported data, curation history and the audit log can never be rewritten.
CREATE TRIGGER cell_immutable BEFORE UPDATE ON cell BEGIN SELECT RAISE(ABORT, 'cells are immutable'); END;
CREATE TRIGGER cell_nodelete BEFORE DELETE ON cell BEGIN SELECT RAISE(ABORT, 'cells are immutable'); END;
CREATE TRIGGER variable_immutable BEFORE UPDATE ON variable BEGIN SELECT RAISE(ABORT, 'variables are immutable; edit metadata via revisions'); END;
CREATE TRIGGER dataset_immutable BEFORE UPDATE ON dataset_version BEGIN SELECT RAISE(ABORT, 'dataset versions are immutable'); END;
CREATE TRIGGER revision_immutable BEFORE UPDATE ON revision BEGIN SELECT RAISE(ABORT, 'revisions are append-only'); END;
CREATE TRIGGER revision_nodelete BEFORE DELETE ON revision BEGIN SELECT RAISE(ABORT, 'revisions are append-only'); END;
CREATE TRIGGER audit_immutable BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER audit_nodelete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER saved_view_immutable BEFORE UPDATE OF spec_json, dataset_version_id, metadata_version ON saved_view BEGIN SELECT RAISE(ABORT, 'saved views are immutable; save a new view'); END;
`,
  /* 2: compare boards (layouts are editable; the views they show stay immutable) */ `
CREATE TABLE compare_board (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  layout_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  author_label TEXT
);
`
]
