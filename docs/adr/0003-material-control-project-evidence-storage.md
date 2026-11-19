# Store project evidence under the durable data root

Project documents and generated exports will live under the existing `BIDTOOL_DATA_DIR` tree at `material-control/projects/{projectUuid}/...`, with UUID path segments, sanitized filenames, checksums, size, MIME type, and relative paths recorded in PostgreSQL. The database remains authoritative for document metadata and inventory state; files are evidence only. Keeping the tree inside the existing durable root lets the current on-prem backup, restore, and Electron migration contracts extend without introducing another storage service.
