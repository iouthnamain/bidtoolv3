# BidTool material control

Material control tracks what a project needs, what has been ordered, where stock is located, what has moved between locations, and what has been installed. It connects project workspaces with the reusable material catalog while keeping physical stock and project evidence auditable.

## Projects and plans

**Project workspace**:
A project-scoped area that owns material plans, requirements, operational documents, and links to one or more tender records.
_Avoid_: Inventory, warehouse, folder

**Material plan**:
A named set of material requirements and dates for one project workspace. A project may have more than one plan when work is phased or separated by package.
_Avoid_: BOQ, stock list

**Requirement**:
A planned need for a quantity of one material, with a unit, specification snapshot, target location, and required date.
_Avoid_: Demand status, inventory row

**Material catalog item**:
A reusable row from the global `materials` catalog. A requirement may link to one, but the requirement keeps its own name, specification, and unit snapshot.
_Avoid_: Project material, SKU

## Procurement and stock

**Purchase commitment**:
A quantity that has been ordered or otherwise committed by a supplier. It does not increase physical stock until a receipt is recorded.
_Avoid_: Stock, receipt

**Shipment**:
A dated movement from a source location toward a destination. Dispatch reduces source on-hand; site receipt adds the received quantity at the destination and supports partial receipt.
_Avoid_: Purchase commitment, delivery status only

**Reservation**:
A claim that a project has on shared on-hand stock. Reserved quantity is excluded from available stock until released or fulfilled.
_Avoid_: Allocation status, ownership

**Location**:
A physical or virtual place where material can be held or consumed, such as a warehouse, site, zone, transit state, installed state, or waste state.
_Avoid_: Place, address

**Stock movement**:
An append-only record of a physical quantity change at a location. Transfers use an outgoing and an incoming movement.
_Avoid_: Stock edit, status update

**Installation**:
A consumption movement from a site or zone into an installed virtual location. It reduces available site stock and increases installed quantity.
_Avoid_: Installed flag, completion status

**In transit**:
Quantity shipped from a source location that has not yet been received at its destination.
_Avoid_: Shipped stock, missing stock

**Available stock**:
On-hand quantity at a location minus active reservations for that location and material.
_Avoid_: Remaining stock, free stock

## Evidence

**Project document**:
A file attached to a project workspace as operational evidence, such as a purchase order, delivery note, shipment photo, or installation record. The database stores its metadata and the file system stores its bytes.
_Avoid_: Source of truth, inventory record

**Movement correction**:
A reversal or adjustment movement that corrects an earlier movement without editing or deleting the original record.
_Avoid_: Manual stock edit, overwrite
