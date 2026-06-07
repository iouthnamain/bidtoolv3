# Workflow 02 - Excel Workspace Material Sourcing

## Goal

Turn a material workbook or manually entered material list into a reviewed
standard workbook with catalog links, source evidence, and export-ready sheets.

Target flow:

`prepare catalog -> create workspace -> configure workbook -> import or add rows -> review rows -> research sources -> select evidence -> validate -> export`

## Users

- Procurement or operations staff preparing material workbooks.
- Reviewers checking quantities, prices, and source evidence.
- Analysts maintaining the internal material catalog.

## Entry Points

- `/materials` for the internal material catalog.
- `/materials/new` for one-off catalog creation.
- `/materials/import` for bulk catalog import.
- `/materials/[id]` for material detail, price links, and workspace usage.
- `/excel-workspace` for workspace list and creation.
- `/excel-workspace/[id]?step=setup|import|rows|research|export` for the
  guided workbook flow.

## Overall Flow

```mermaid
flowchart LR
  catalog["Prepare material catalog"]
  workspace["Create or open Excel Workspace"]
  setup["Setup headers and selected sheets"]
  import["Upload workbook or add rows"]
  rows["Review and edit material rows"]
  research["Find source evidence"]
  select["Select catalog, web, or manual evidence"]
  validate["Validate export requirements"]
  export["Download workbook"]

  catalog --> workspace --> setup --> import --> rows --> research --> select --> validate --> export
```

## Material Catalog Flow

```mermaid
flowchart LR
  list["Open /materials"]
  search["Search catalog"]
  choose{"Need new material?"}
  create["Create manually"]
  import["Import CSV/XLSX"]
  detail["Open material detail"]
  price["Add fixed price or supplier link"]
  usage["Review workspace usage"]
  ready["Catalog item ready for workspace research"]

  list --> search --> choose
  choose -->|"yes, one item"| create --> detail
  choose -->|"yes, many items"| import --> list
  choose -->|"no"| detail
  detail --> price --> ready
  detail --> usage
```

## Workspace Step Flow

```mermaid
flowchart LR
  list["Open /excel-workspace"]
  create["Create workspace"]
  setup["Setup<br/>headers, recipients, selected sheets"]
  import["Import<br/>file, sheet, header, column mapping"]
  rows["Rows<br/>clean names, units, quantities, prices"]
  research["Research<br/>catalog, web, manual evidence"]
  export["Export<br/>validate and download"]

  list --> create --> setup --> import --> rows --> research --> export
```

## Workspace Navigation Flow

```mermaid
flowchart TB
  open["Open workspace detail"]
  hasRows{"Rows already imported or added?"}
  openRows{"Any rows still without selected evidence?"}
  hasWorkbookAndMapping{"Workbook and mapping are ready?"}
  hasWorkbook{"Workbook uploaded?"}

  research["Next step: research"]
  export["Next step: export"]
  importRows["Next step: import<br/>Rows step can be opened"]
  importOnly["Next step: import"]
  setup["Next step: setup<br/>Rows step can be opened for manual entry"]

  open --> hasRows
  hasRows -->|"yes"| openRows
  openRows -->|"yes"| research
  openRows -->|"no"| export
  hasRows -->|"no"| hasWorkbookAndMapping
  hasWorkbookAndMapping -->|"yes"| importRows
  hasWorkbookAndMapping -->|"no"| hasWorkbook
  hasWorkbook -->|"yes"| importOnly
  hasWorkbook -->|"no"| setup
```

## Research Flow

```mermaid
flowchart LR
  row["Choose a material row"]
  options{"Evidence source"}
  catalog["Catalog match"]
  web["Web candidate"]
  manual["Manual source entry"]
  compare["Compare evidence, price, origin, supplier"]
  selected["Select final evidence"]
  matched["Row marked matched or manual"]

  row --> options
  options --> catalog --> compare
  options --> web --> compare
  options --> manual --> compare
  compare --> selected --> matched
```

## Export Gate

```mermaid
flowchart TB
  exportStep["Export step"]
  validate["Validate workbook"]
  blocking{"Blocking issue?"}
  fix["Return to setup, rows, or research"]
  download["Download standard workbook"]

  noSheets["No selected sheet template"]
  noRows["No included rows"]
  missing["Missing material name or unit"]
  quantity["Invalid quantity, stock, or reuse percent"]
  emptySheet["Selected purchase or inspection sheet would be empty"]
  warnings["Warnings: missing evidence, missing unit price, duplicates"]

  exportStep --> validate --> blocking
  noSheets --> blocking
  noRows --> blocking
  missing --> blocking
  quantity --> blocking
  emptySheet --> blocking
  warnings -. allow download .-> download
  blocking -->|"yes"| fix
  blocking -->|"no"| download
```

## Status Diagram

```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> imported: workbook uploaded
  imported --> mapped: required columns mapped
  mapped --> reviewed: rows imported or manually added
  reviewed --> matched: all open rows have selected evidence
  matched --> exported: enriched export path records exported status

  reviewed --> reviewed: row edits continue
  matched --> reviewed: evidence cleared or row edited
  exported --> [*]
```

## Standard Workbook Output

The standard workbook can include these sheets, depending on the user's setup:

- THVT summary.
- Purchase request.
- Inspection term 1.
- Inspection term 2.
- Evidence.

## Completion Point

The workflow is complete when the user downloads a validated workbook and any
remaining warnings are understood or accepted.

## Exceptions

- Workbook has many sheets: user must choose the sheet explicitly.
- Header row is ambiguous: user reviews and adjusts the header row.
- Required mapping is missing: import waits until the material-name mapping is
  available.
- Source search fails: user can use catalog evidence or enter a manual source.
- Row is not needed for export: user excludes the row so it does not affect the
  workbook.
