import { OrderDocumentsBuilder } from "../OrderDocumentsBuilder";

export function DocumentsPage() {
  return (
    <div className="h-full overflow-auto bg-slate-50">
      <OrderDocumentsBuilder />
    </div>
  );
}
