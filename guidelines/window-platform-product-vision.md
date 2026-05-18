# Window CRM Product Vision

## Product goal

The product is a single operating platform for a window, door and balcony business. Manager, measurer, warehouse, purchaser and installers work on the same order data.

Core value:

- reduce measurement and quote errors;
- generate commercial offers with window schemes;
- calculate material needs, reservations and supplier requests;
- show owner/admin planned and actual cost, gross profit and margin per order.

## Core workflow

1. Manager creates an order with client, object address and work type: windows, doors, balcony glazing, balcony finishing or repair.
2. Measurement is scheduled. Measurer enters dimensions, conditions and photos.
3. AI vision can parse photos/sketches into `WindowConstruct[]`.
4. Configurator calculates the offer from price matrices and work rates.
5. Client approves the offer. The system creates BOM requirements, reserves warehouse stock and creates supplier requests for deficits.
6. Materials are received, production/assembly is tracked, installation is scheduled.
7. Installers record actual consumption, photos and client signature.
8. Documents are generated: offer, contract, specification, payment schedule, act.
9. The order closes with planned and actual margin snapshots.

## Key entities

- `WindowConstruct`: measured product structure, dimensions, segments, opening directions and options.
- `window_price_matrices` / `window_price_matrix_cells`: supplier price grids by profile, glass unit, color and size.
- `window_work_rates`: installation, dismantling, finishing, lifting, delivery and other labor/service rates.
- `warehouse_items`: internal SKU catalog.
- `warehouse_stock`: physical stock.
- `inventory_movements`: stock audit log.
- `suppliers`, `supplier_items`, `catalog_links`: supplier catalog and links to internal SKUs.
- `order_material_requirements`: BOM needs per approved order.
- `warehouse_reservations`: reserved stock for orders.
- `supplier_requests`: procurement need grouped by supplier.
- `order_profit_snapshots`: planned/actual revenue, cost and margin.
- `measurement_ai_jobs`: AI photo/sketch parsing log.
- `window_production_items`: production, readiness and claim status per construction.
- `order_payment_schedule`: advance, stage payments and final payment.

## Role visibility

Manager:

- client and order data;
- measurement status;
- offer and client price;
- material status as simple labels: in stock / waiting / ready.

Measurer and installer:

- tasks;
- schemes;
- measurement and installation checklists;
- photos;
- actual consumption.

Warehouse and procurement:

- stock;
- movements;
- reservations;
- supplier requests;
- purchase orders;
- receiving.

Admin/owner:

- revenue;
- material cost;
- labor cost;
- supplier cost;
- overhead;
- gross profit;
- gross margin;
- team load and warehouse turnover.

## AI measurement contract

Endpoint:

`POST /make-server-1df47c03/orders/:id/measurement-ai/parse`

Without parsed JSON, the endpoint returns the expected prompt and schema. With parsed JSON, it stores constructions in the order, marks the survey as done and writes a timeline event.

Expected model output:

```json
{
  "constructs": [
    {
      "title": "Окно 1",
      "roomName": "Кухня",
      "constructionType": "window",
      "widthMm": 1400,
      "heightMm": 1300,
      "quantity": 1,
      "profileSystem": "Brusbox 60-3 СП32",
      "glassUnit": "СП32",
      "hardwareType": "Futuruss",
      "lamination": "none",
      "sillDepthMm": 250,
      "dripCapDepthMm": 150,
      "mosquitoNet": false,
      "slopes": "none",
      "segments": [
        {
          "kind": "fixed",
          "opening": "fixed",
          "widthRatio": 1
        },
        {
          "kind": "sash",
          "opening": "tilt_turn",
          "widthRatio": 1,
          "handleSide": "right"
        }
      ],
      "notes": "Перепроверить высоту по чистому проему"
    }
  ],
  "confidence": 86,
  "warnings": ["часть размера перекрыта рукой"]
}
```

## Pricing and margin logic

Client price comes from:

- matrix price by profile, glass, color and size;
- additions: sill, drip cap, mosquito net, slopes, delivery;
- labor/work rates;
- manual discounts.

Planned cost comes from:

- supplier item price;
- internal warehouse purchase price;
- labor rates;
- overhead rule.

Actual cost comes from:

- purchase order line prices;
- actual material consumption;
- actual installer/labor entries.

The admin panel should always show both:

- planned margin before procurement;
- actual margin after receiving and consumption.
